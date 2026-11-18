const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const DATA_DIR = process.env.INTERVUE_DATA_DIR || path.join(__dirname, '..', 'data');
const INTERVIEWS_PATH = path.join(DATA_DIR, 'interviews.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined })
  : null;
let users = [];
let fileQueue = Promise.resolve();

async function readJson(filePath, fallback = []) {
  try {
    const result = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(result) ? result : fallback;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJson(filePath, value) {
  fileQueue = fileQueue.catch(() => {}).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2));
    await fs.rename(temporaryPath, filePath);
  });
  return fileQueue;
}

async function initializeStore() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS interviews (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS interviews_user_created_idx ON interviews(user_id, created_at DESC);
    `);
    return [];
  }
  users = await readJson(USERS_PATH);
  const interviews = await readJson(INTERVIEWS_PATH);
  return interviews;
}

async function getUserByEmail(email) {
  if (pool) {
    const result = await pool.query('SELECT id, email, password_hash AS "passwordHash" FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }
  return users.find((user) => user.email === email) || null;
}

async function getUserById(id) {
  if (pool) {
    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
  const user = users.find((item) => item.id === id);
  return user ? { id: user.id, email: user.email } : null;
}

async function createUser(user) {
  if (pool) {
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [user.id, user.email, user.passwordHash]);
    return;
  }
  users.push(user);
  await writeJson(USERS_PATH, users);
}

async function listInterviews(userId) {
  if (pool) {
    const result = await pool.query('SELECT data FROM interviews WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows.map((row) => row.data);
  }
  return readJson(INTERVIEWS_PATH).then((items) => items.filter((item) => item.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

async function getInterview(id, userId) {
  if (pool) {
    const result = await pool.query('SELECT data FROM interviews WHERE id = $1 AND user_id = $2', [id, userId]);
    return result.rows[0]?.data || null;
  }
  const items = await readJson(INTERVIEWS_PATH);
  return items.find((item) => item.id === id && item.userId === userId) || null;
}

async function saveInterview(interview) {
  if (pool) {
    await pool.query(
      `INSERT INTO interviews (id, user_id, created_at, data)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at, data = EXCLUDED.data`,
      [interview.id, interview.userId, interview.createdAt, JSON.stringify(interview)],
    );
    return;
  }
  const items = await readJson(INTERVIEWS_PATH);
  const index = items.findIndex((item) => item.id === interview.id);
  if (index < 0) items.unshift(interview);
  else items[index] = interview;
  await writeJson(INTERVIEWS_PATH, items);
}

async function closeStore() {
  await pool?.end();
}

async function checkStore() {
  if (pool) await pool.query('SELECT 1');
  return pool ? 'postgres' : 'local-json';
}

module.exports = { initializeStore, getUserByEmail, getUserById, createUser, listInterviews, getInterview, saveInterview, checkStore, closeStore, hasDatabase: Boolean(pool) };
