# Intervue — AI Mock Interviewer

Adaptive interview practice with personalized questions, evidence-based scoring, skill analysis, recommendations, and session history.

## Start the whole app locally

1. Install Docker Desktop.
2. Copy `Backend/.env.example` to `Backend/.env` and add a Google Gemini API key.
3. From this project root run `docker compose up --build`.
4. Open `http://localhost:8080`. PostgreSQL-backed data persists in the `postgres_data` Docker volume.

For non-Docker development, follow the setup notes in [Backend/README.md](./Backend/README.md) and [Frontend/README.md](./Frontend/README.md). Backend checks run with `npm test` from `Backend`.

## Deploy

Deploy the frontend and Express API together as one Vercel Services project using the root `vercel.json`; add a Postgres Marketplace integration and configure `GEMINI_API_KEY` and `JWT_SECRET`. See the [backend deployment guide](./Backend/README.md). `render.yaml` is an alternate Render Blueprint, and `compose.yaml` runs the stack locally. Set secrets only in hosting-provider environment settings.
