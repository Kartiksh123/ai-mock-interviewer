require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
function currentModelId(model) {
  if (model === 'gemini-2.0-flash') return 'gemini-3.8-flash';
  if (model === 'gemini-3.5-flash') return 'gemini-3.6-flash';
  return model;
}
const MODEL = currentModelId(process.env.GEMINI_MODEL || 'gemini-3.8-flash');
const FALLBACK_MODEL = currentModelId(process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash');
const JWT_SECRET = process.env.JWT_SECRET || 'local-development-secret-change-before-deploy';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'application/pdf') {
      const error = new Error('Please upload a PDF file.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((origin) => {
  const normalized = origin.trim();
  return normalized.startsWith('http://') || normalized.startsWith('https://') ? normalized : `https://${normalized}`;
});
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

let interviews = [];
const interviewsBeingAnswered = new Set();
let initialization;

async function ensureInitialized() {
  if (!initialization) {
    initialization = (async () => {
      if (process.env.NODE_ENV === 'production') {
        if (!(process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL || process.env.POSTGRES_URL)) {
          throw new Error('Set DATABASE_URL or connect a Postgres integration that provides DATABASE_POSTGRES_URL.');
        }
        if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required in production.');
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set a JWT_SECRET of at least 32 characters in production.');
      }
      interviews = await store.initializeStore();
    })();
  }
  return initialization;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestGemini(model, key, instruction, input) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts: Array.isArray(input) ? input : [{ text: input }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Gemini request failed.');
    error.status = response.status === 429 ? 429 : 502;
    error.retryable = [500, 502, 503].includes(response.status) || /high demand|overload(?:ed)?|temporarily unavailable/i.test(error.message);
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw Object.assign(new Error('Gemini returned an empty response.'), { status: 502 });

  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Gemini returned invalid JSON. Please try again.'), { status: 502 });
  }
}

function retryDelay(error, attempt, baseDelayMs) {
  const parsedSeconds = Number(error.retryAfter);
  const parsedDate = Date.parse(error.retryAfter || '');
  const retryAfterMs = Number.isFinite(parsedSeconds)
    ? parsedSeconds * 1000
    : Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : 0;
  return Math.max(baseDelayMs * (2 ** attempt), Math.min(5000, retryAfterMs)) + Math.floor(Math.random() * 150);
}

async function askGemini(instruction, input, options = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const error = new Error('Gemini is not configured. Add GEMINI_API_KEY to Backend/.env.');
    error.status = 503;
    throw error;
  }

  const models = [...new Set(options.models || [MODEL, FALLBACK_MODEL])];
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastError;
  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await requestGemini(models[modelIndex], key, instruction, input);
      } catch (error) {
        lastError = error;
        const retryable = error.retryable || ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name);
        if (!retryable) throw error;
        if (attempt < retries) {
          await sleep(retryDelay(error, attempt, baseDelayMs));
          continue;
        }
        if (modelIndex < models.length - 1) break;
      }
    }
  }

  const overloaded = new Error('Gemini is busy right now. We tried again and used the backup model, but it is still unavailable. Please wait a moment and retry.');
  overloaded.status = 503;
  overloaded.cause = lastError;
  throw overloaded;
}

async function getInterview(id, userId) {
  if (store.hasDatabase) return store.getInterview(id, userId);
  return interviews.find((interview) => interview.id === id && interview.userId === userId);
}

function publicInterview(interview) {
  const { resumeText, userId, ...result } = interview;
  return result;
}

async function createReport(interview) {
  const scored = interview.answers;
  const average = (key) => Math.round(scored.reduce((sum, item) => sum + (Number(item.evaluation[key]) || 0), 0) / scored.length);
  interview.scores = {
    technical: average('technicalScore'),
    communication: average('communicationScore'),
    overall: Math.round((average('technicalScore') + average('communicationScore')) / 2),
  };
  interview.report = await askGemini(
    'Create a concise, evidence-based interview report. Return JSON with keys: summary (string), strengths (array of strings), improvementAreas (array of strings), skillGaps (array of objects with skill and evidence), recommendations (array of strings), practiceQuestions (array of strings). Use the candidate answers and evaluation evidence. Avoid unsupported conclusions.',
    JSON.stringify({ role: interview.role, scores: interview.scores, answers: scored.map(({ question: q, skill, answer: a, evaluation }) => ({ question: q, skill, answer: a, evaluation })) }),
  );
}

app.get('/api/health', async (_req, res) => {
  try {
    const database = await store.checkStore();
    res.json({ status: 'ok', service: 'ai-mock-interviewer-api', database });
  } catch {
    res.status(503).json({ status: 'unavailable', service: 'ai-mock-interviewer-api', database: 'unavailable' });
  }
});

// Vercel imports the Express app without calling start(); initialize the store on
// the first request in either serverless or long-running environments.
app.use('/api', async (_req, _res, next) => {
  try { await ensureInitialized(); next(); } catch (error) { next(error); }
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
    }
    if (await store.getUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const user = { id: randomUUID(), email, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
    await store.createUser(user);
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '12h', issuer: 'intervue-api', audience: 'intervue-client' });
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    const user = await store.getUserByEmail(email);
    if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '12h', issuer: 'intervue-api', audience: 'intervue-client' });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) { next(error); }
});

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const claims = jwt.verify(token, JWT_SECRET, { issuer: 'intervue-api', audience: 'intervue-client' });
    req.user = { id: claims.sub, email: claims.email };
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await store.getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Account not found. Sign in again.' });
    res.json({ user });
  } catch (error) { next(error); }
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  return requireAuth(req, res, next);
});

app.post('/api/resume/analyze', aiLimiter, upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach a PDF in the "resume" field.' });
    const parsed = await pdf(req.file.buffer);
    let resumeText = parsed.text.trim();
    let analysis;
    const analysisInstruction = 'You are a careful resume parser. Extract only evidence present in the resume. Return JSON with keys: summary (string), skills (array of strings), experience (array of objects with title, company, duration, highlights), projects (array of objects with name, technologies, description), education (array of strings). Use empty arrays when details are missing. Do not invent facts.';
    if (resumeText.length < 40) {
      const recognized = await askGemini(
        'Read this PDF resume, including scanned page images, and transcribe relevant text. Return JSON with keys extractedText (string with readable resume content) and analysis (object containing summary, skills, experience, projects, education). Keep only resume evidence and never invent facts.',
        [
          { inlineData: { mimeType: 'application/pdf', data: req.file.buffer.toString('base64') } },
          { text: analysisInstruction },
        ],
      );
      resumeText = typeof recognized.extractedText === 'string' ? recognized.extractedText.trim() : '';
      analysis = recognized.analysis;
      if (resumeText.length < 40) return res.status(422).json({ error: 'Could not read enough text from this PDF, even with visual extraction.' });
    } else {
      const recognized = await askGemini(analysisInstruction, `Resume text:\n${resumeText.slice(0, 24000)}`);
      analysis = recognized;
    }

    res.json({ resumeText: resumeText.slice(0, 24000), analysis });
  } catch (error) {
    next(error);
  }
});

app.post('/api/job/analyze', aiLimiter, async (req, res, next) => {
  try {
    const { jobDescription } = req.body || {};
    if (typeof jobDescription !== 'string' || jobDescription.trim().length < 30) {
      return res.status(400).json({ error: 'Provide a job description with at least 30 characters.' });
    }
    const analysis = await askGemini(
      'Analyze a job description for interview preparation. Return JSON with keys: role (string), requiredSkills (array of strings), responsibilities (array of strings), seniority (string), interviewFocus (array of strings). Base the result only on the text.',
      jobDescription.slice(0, 16000),
    );
    res.json({ analysis });
  } catch (error) {
    next(error);
  }
});

app.post('/api/interviews', aiLimiter, async (req, res, next) => {
  try {
    const { role, jobDescription, resumeText = '', resumeAnalysis = null, jobAnalysis = null, questionCount = 5 } = req.body || {};
    if (typeof role !== 'string' || !role.trim()) {
      return res.status(400).json({ error: 'Choose a job role.' });
    }
    if (!jobDescription || typeof jobDescription !== 'string') {
      return res.status(400).json({ error: 'Provide a job description.' });
    }
    if (typeof resumeText !== 'string' || resumeText.length > 24000) {
      return res.status(400).json({ error: 'resumeText must be a string up to 24,000 characters.' });
    }

    const questions = await askGemini(
      'You are a technical interviewer. Create realistic, specific questions grounded in the candidate resume and the job description. Mix fundamentals and applied questions. Return JSON with key "questions", an array of objects with "question" (string), "skill" (string), and "type" (technical, behavioral, or project). Keep questions concise and do not include answers.',
      JSON.stringify({ role, jobDescription: jobDescription.slice(0, 12000), resumeAnalysis, jobAnalysis, resumeText: resumeText.slice(0, 12000), questionCount: Math.min(Math.max(Number(questionCount) || 5, 1), 10) }),
    );
    if (!Array.isArray(questions.questions) || questions.questions.length === 0) {
      return res.status(502).json({ error: 'Could not generate interview questions. Please try again.' });
    }

    const interview = {
      id: randomUUID(),
      userId: req.user.id,
      role: role.trim(),
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      completedAt: null,
      resumeText: resumeText.slice(0, 24000),
      questions: questions.questions.slice(0, 10).map((item) => ({ ...item, id: randomUUID() })),
      currentQuestionIndex: 0,
      answers: [],
      scores: null,
      report: null,
    };
    if (!store.hasDatabase) interviews.unshift(interview);
    await store.saveInterview(interview);
    res.status(201).json(publicInterview(interview));
  } catch (error) {
    next(error);
  }
});

app.get('/api/interviews', async (req, res, next) => {
  try {
    const items = store.hasDatabase ? await store.listInterviews(req.user.id) : interviews.filter((item) => item.userId === req.user.id);
    res.json({ interviews: items.map(publicInterview) });
  } catch (error) { next(error); }
});

app.get('/api/interviews/:id', async (req, res, next) => {
  try {
    const interview = await getInterview(req.params.id, req.user.id);
    if (!interview) return res.status(404).json({ error: 'Interview not found.' });
    res.json(publicInterview(interview));
  } catch (error) { next(error); }
});

app.post('/api/interviews/:id/answer', aiLimiter, async (req, res, next) => {
  let interview;
  try {
    interview = await getInterview(req.params.id, req.user.id);
    if (!interview) return res.status(404).json({ error: 'Interview not found.' });
    if (interview.status === 'completed') return res.status(409).json({ error: 'This interview is already complete.' });
    if (interviewsBeingAnswered.has(interview.id)) return res.status(409).json({ error: 'An answer for this interview is already being processed.' });

    const { answer } = req.body || {};
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: 'Provide an answer.' });
    }
    if (answer.length > 12000) return res.status(413).json({ error: 'Answer must be under 12,000 characters.' });

    interviewsBeingAnswered.add(interview.id);
    const question = interview.questions[interview.currentQuestionIndex];
    const evaluation = await askGemini(
      'Evaluate the candidate answer fairly and with evidence. Return JSON with keys: technicalScore (0-100 number), communicationScore (0-100 number), correctness (string), strengths (array of strings), missingConcepts (array of strings), idealAnswer (string), followUp (string or null). Ask one relevant follow-up only when the answer has a meaningful gap or an opportunity to probe depth; otherwise set followUp to null. Do not reward claims unsupported by the answer. Scores must be integers from 0 to 100.',
      JSON.stringify({ role: interview.role, question: question.question, skill: question.skill, answer: answer.trim(), previousAnswers: interview.answers.map(({ question: q, answer: a }) => ({ question: q, answer: a })) }),
    );
    evaluation.technicalScore = Math.max(0, Math.min(100, Number(evaluation.technicalScore) || 0));
    evaluation.communicationScore = Math.max(0, Math.min(100, Number(evaluation.communicationScore) || 0));

    // Only probe once per main question; the candidate can still receive one follow-up per topic.
    const entry = {
      questionId: question.id,
      question: question.question,
      skill: question.skill,
      answer: answer.trim(),
      evaluation,
      answeredAt: new Date().toISOString(),
    };
    interview.answers.push(entry);

    const followUpText = question.type !== 'follow_up' && typeof evaluation.followUp === 'string' && evaluation.followUp.trim()
      ? evaluation.followUp.trim()
      : null;
    if (followUpText) {
      interview.questions.splice(interview.currentQuestionIndex + 1, 0, {
        id: randomUUID(), question: followUpText, skill: question.skill, type: 'follow_up',
      });
    }
    interview.currentQuestionIndex += 1;
    const nextQuestion = interview.questions[interview.currentQuestionIndex] || null;

    if (!nextQuestion) {
      interview.status = 'completed';
      interview.completedAt = new Date().toISOString();
      const scored = interview.answers;
      const average = (key) => Math.round(scored.reduce((sum, item) => sum + (Number(item.evaluation[key]) || 0), 0) / scored.length);
      interview.scores = {
        technical: average('technicalScore'),
        communication: average('communicationScore'),
        overall: Math.round((average('technicalScore') + average('communicationScore')) / 2),
      };
    }

    await store.saveInterview(interview);
    let reportError;
    if (interview.status === 'completed' && !interview.report) {
      try {
        await createReport(interview);
        await store.saveInterview(interview);
      } catch (error) {
        // The answer and scores are already saved. The report route can retry later.
        reportError = error.message;
      }
    }
    res.json({ evaluation, nextQuestion, status: interview.status, scores: interview.scores, report: interview.report, ...(reportError ? { reportError } : {}) });
  } catch (error) {
    next(error);
  } finally {
    if (interview) interviewsBeingAnswered.delete(interview.id);
  }
});

app.get('/api/interviews/:id/report', aiLimiter, async (req, res, next) => {
  try {
    const interview = await getInterview(req.params.id, req.user.id);
    if (!interview) return res.status(404).json({ error: 'Interview not found.' });
    if (interview.status !== 'completed') return res.status(409).json({ error: 'The interview report is available after the interview is complete.' });
    if (!interview.report) {
      await createReport(interview);
      await store.saveInterview(interview);
    }
    res.json({ id: interview.id, role: interview.role, scores: interview.scores, answers: interview.answers, report: interview.report });
  } catch (error) { next(error); }
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const userInterviews = store.hasDatabase ? await store.listInterviews(req.user.id) : interviews.filter((interview) => interview.userId === req.user.id);
    const completed = userInterviews.filter((interview) => interview.status === 'completed');
    const average = (key) => completed.length
      ? Math.round(completed.reduce((total, interview) => total + (interview.scores?.[key] || 0), 0) / completed.length)
      : 0;
    const skills = {};
    for (const interview of completed) {
      for (const answer of interview.answers) {
        const key = answer.skill || 'General';
        const score = Number(answer.evaluation?.technicalScore) || 0;
        skills[key] ||= { total: 0, count: 0 };
        skills[key].total += score;
        skills[key].count += 1;
      }
    }
    res.json({
      totalInterviews: userInterviews.length,
      completedInterviews: completed.length,
      averageOverall: average('overall'),
      averageTechnical: average('technical'),
      averageCommunication: average('communication'),
      skillPerformance: Object.entries(skills).map(([skill, value]) => ({ skill, score: Math.round(value.total / value.count), answers: value.count })),
      recentInterviews: userInterviews.slice(0, 5).map(publicInterview),
    });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  if (status >= 500 && status !== 503) console.error(error);
  res.status(status).json({ error: error.message || 'Something went wrong.' });
});

async function start() {
  await ensureInitialized();
  return app.listen(PORT, () => console.log(`AI Mock Interviewer API listening on http://localhost:${PORT}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Could not start API:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.app = app;
module.exports.start = start;
module.exports.requireAuth = requireAuth;
module.exports.askGemini = askGemini;
