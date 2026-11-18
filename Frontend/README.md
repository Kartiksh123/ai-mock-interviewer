# Intervue frontend

React + Vite client for the AI Mock Interviewer API. It includes candidate sign-in and registration, resume/JD setup, the live adaptive interview, interview history, and detailed reports.

Use Node.js `^20.19.0` or `>=22.12.0` for Vite 8.

## Local development

1. Start the API from `../Backend` with `npm run dev`.
2. Run `npm install` in `Frontend`.
3. Copy `.env.example` to `.env.local` if the API is not at `http://localhost:3000/api`.
4. Run `npm run dev` and open the URL Vite prints (normally `http://localhost:5173`).

For the full PostgreSQL-backed app, run `docker compose up --build` from the repository root and open `http://localhost:8080`. Set the Gemini key in `Backend/.env`; the browser never receives it.

For Vercel, import the repository root as one project. The root `vercel.json` deploys the frontend and API together; production API requests use the same-origin `/api` route. See `../Backend/README.md` for database and secret configuration.
