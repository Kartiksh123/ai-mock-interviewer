# Intervue API

Express API for resume and job analysis, adaptive interviews, evidence-based evaluation, reporting, candidate accounts, and interview history.

## Local development

1. Install Node.js 20 or newer.
2. Run `npm install` in `Backend`.
3. Copy `.env.example` to `.env` and add a Gemini API key. `DATABASE_URL` can stay empty to use the local JSON development store.
4. Run `npm run dev`.
5. Run API checks with `npm test`.

To use PostgreSQL locally, run the project from its root with `docker compose up --build`. This starts PostgreSQL, the API, and the web app. Interview and user JSON files are for local non-container development only. PostgreSQL is required when `NODE_ENV=production`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-only Google Gemini key |
| `GEMINI_MODEL` | Model ID, default `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Backup model used after temporary overloads, default `gemini-3.6-flash` |
| `DATABASE_URL` | PostgreSQL connection string; blank uses local JSON |
| `DATABASE_SSL` | Set `true` when the database provider requires SSL |
| `JWT_SECRET` | Access-token signing secret; use a random secret of at least 32 characters in production |
| `FRONTEND_ORIGIN` | Comma-separated allowed frontend origins |

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Public API/database health |
| POST | `/api/auth/register` | Create an account; accepts `{ email, password }` |
| POST | `/api/auth/login` | Sign in; accepts `{ email, password }` |
| GET | `/api/auth/me` | Get the signed-in account |
| POST | `/api/resume/analyze` | Analyze a PDF in multipart field `resume` |
| POST | `/api/job/analyze` | Analyze `{ jobDescription }` |
| POST | `/api/interviews` | Create an interview |
| GET | `/api/interviews` | List the signed-in candidate’s sessions |
| GET | `/api/interviews/:id` | Read a session owned by the signed-in candidate |
| POST | `/api/interviews/:id/answer` | Evaluate `{ answer }` and return a follow-up or next question |
| GET | `/api/interviews/:id/report` | Get a completed report |
| GET | `/api/dashboard` | Get scores and skill performance for the signed-in candidate |

All endpoints except health, register, and login require `Authorization: Bearer <token>`. Passwords are hashed, tokens expire after 12 hours, authentication attempts are rate limited, and interview reads are scoped to their owner. Temporary Gemini overloads use exponential backoff and a backup model. Scanned PDFs use Gemini’s PDF vision input when local text extraction finds too little text.

## Deployment

The repository root has a Render Blueprint in `render.yaml` and a Docker Compose setup. Render prompts for `GEMINI_API_KEY`, generates the token secret, provisions PostgreSQL, and wires the API and static frontend services. Review the selected database plan in Render before creating resources. For Vercel, import the `Frontend` folder and set `VITE_API_URL` to the deployed API URL ending in `/api`; configure the API’s `FRONTEND_ORIGIN` to the deployed frontend origin.

Never commit `.env` files or API keys. Before a public launch, also configure custom domains/HTTPS, backups and data-retention policy for resumes and interview answers.
