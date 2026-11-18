const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.INTERVUE_DATA_DIR = path.join(os.tmpdir(), `intervue-test-${randomUUID()}`);
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';

const request = require('supertest');
const { app, askGemini } = require('../src/server');
const store = require('../src/store');

let account;
let token;
let accountId;
let secondToken;

before(async () => {
  await store.initializeStore();
});

after(async () => {
  await store.closeStore();
});

test('health endpoint is public', async () => {
  const response = await request(app).get('/api/health').expect(200);
  if (response.body.status !== 'ok') throw new Error('health status should be ok');
});

test('private endpoints reject anonymous requests', async () => {
  await request(app).get('/api/dashboard').expect(401);
  await request(app).get('/api/interviews').expect(401);
});

test('candidate can register, sign in, and access only an authenticated workspace', async () => {
  account = { email: `candidate-${randomUUID()}@example.test`, password: 'practice-password-123' };
  const registered = await request(app).post('/api/auth/register').send(account).expect(201);
  token = registered.body.token;
  accountId = registered.body.user.id;
  if (!token || registered.body.user.email !== account.email) throw new Error('registration should return an access token and user');

  await request(app).post('/api/auth/register').send(account).expect(409);
  const signedIn = await request(app).post('/api/auth/login').send(account).expect(200);
  await request(app).post('/api/auth/login').send({ ...account, password: 'wrong-password-123' }).expect(401);

  const identity = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signedIn.body.token}`).expect(200);
  if (identity.body.user.email !== account.email) throw new Error('identity endpoint should return the authenticated user');
  const dashboard = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`).expect(200);
  if (dashboard.body.totalInterviews !== 0) throw new Error('new account should have an empty workspace');

  const second = await request(app).post('/api/auth/register').send({ email: `other-${randomUUID()}@example.test`, password: account.password }).expect(201);
  secondToken = second.body.token;
});

test('registration validates email and password', async () => {
  await request(app).post('/api/auth/register').send({ email: 'bad-email', password: 'practice-password-123' }).expect(400);
  await request(app).post('/api/auth/register').send({ email: `short-${randomUUID()}@example.test`, password: 'short' }).expect(400);
});

test('AI routes require authentication and report missing server-side Gemini setup', async () => {
  await request(app).post('/api/job/analyze').send({ jobDescription: 'A sufficiently detailed job description.' }).expect(401);
  await request(app)
    .post('/api/job/analyze')
    .set('Authorization', `Bearer ${token}`)
    .send({ jobDescription: 'A sufficiently detailed job description for a candidate role.' })
    .expect(503);
});

test('interview history stays scoped to the owning account', async () => {
  const originalFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ question: 'Explain a hash map.', skill: 'Data structures', type: 'technical' }] }) }] } }] }),
  });
  try {
    const created = await request(app)
      .post('/api/interviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Python Developer', jobDescription: 'A Python role description that is long enough to be accepted.', resumeText: '' })
      .expect(201);
    const ownerHistory = await request(app).get('/api/interviews').set('Authorization', `Bearer ${token}`).expect(200);
    const otherHistory = await request(app).get('/api/interviews').set('Authorization', `Bearer ${secondToken}`).expect(200);
    if (ownerHistory.body.interviews.length !== 1) throw new Error('owner should see their interview');
    if (otherHistory.body.interviews.length !== 0) throw new Error('other account must not see the interview');
    await request(app).get(`/api/interviews/${created.body.id}`).set('Authorization', `Bearer ${secondToken}`).expect(404);
  } finally {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = '';
  }
});

test('Gemini overload retries with the configured backup model', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const models = [];
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async (url) => {
    models.push(String(url).match(/models\/([^:]+)/)?.[1]);
    if (models.length === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
    };
  };
  try {
    const result = await askGemini('Return JSON.', 'test prompt', { models: ['primary-model', 'backup-model'], retries: 0, baseDelayMs: 0 });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(models, ['primary-model', 'backup-model']);
  } finally {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalKey;
  }
});

test('Gemini quota errors are returned without retrying or switching models', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ error: { message: 'Quota exceeded for this project.' } }),
    };
  };
  try {
    await assert.rejects(askGemini('Return JSON.', 'test prompt'), { status: 429, message: 'Quota exceeded for this project.' });
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalKey;
  }
});
