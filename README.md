# Intervue — AI Mock Interviewer

Adaptive interview practice with personalized questions, evidence-based scoring, skill analysis, recommendations, and session history.

## Start the whole app locally

1. Install Docker Desktop.
2. Copy `Backend/.env.example` to `Backend/.env` and add a Google Gemini API key.
3. From this project root run `docker compose up --build`.
4. Open `http://localhost:8080`. PostgreSQL-backed data persists in the `postgres_data` Docker volume.

For non-Docker development, follow the setup notes in [Backend/README.md](./Backend/README.md) and [Frontend/README.md](./Frontend/README.md). Backend checks run with `npm test` from `Backend`.

## Deploy

`render.yaml` defines the API, static frontend, and PostgreSQL service for a Render Blueprint. The frontend can also deploy to Vercel; configure `VITE_API_URL` and allow its origin in the backend’s `FRONTEND_ORIGIN` setting. Set secrets only in the hosting provider’s environment settings.
