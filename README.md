# Intervue — AI Mock Interviewer

Adaptive interview practice with personalized questions, evidence-based scoring, skill analysis, recommendations, and session history.

## Start the whole app locally

1. Install Docker Desktop.
2. Copy `Backend/.env.example` to `Backend/.env` and add a Google Gemini API key.
3. From this project root run `docker compose up --build`.
4. Open `http://localhost:8080`. PostgreSQL-backed data persists in the `postgres_data` Docker volume.

For non-Docker development, follow the setup notes in [Backend/README.md](./Backend/README.md) and [Frontend/README.md](./Frontend/README.md). Backend checks run with `npm test` from `Backend`.

## Deploy

Deploy the frontend and API to Vercel as two projects rooted at `Frontend` and `Backend`; connect a Postgres provider and configure `VITE_API_URL`, `FRONTEND_ORIGIN`, `DATABASE_URL`, `GEMINI_API_KEY`, and `JWT_SECRET` in the respective project settings. See the two app READMEs for exact setup steps. `render.yaml` is an alternate Render Blueprint, and `compose.yaml` runs the stack locally. Set secrets only in hosting-provider environment settings.
