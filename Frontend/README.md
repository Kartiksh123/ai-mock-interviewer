# Intervue frontend

React + Vite client for the AI Mock Interviewer API. It includes candidate sign-in and registration, resume/JD setup, the live adaptive interview, interview history, and detailed reports.

Use Node.js `^20.19.0` or `>=22.12.0` for Vite 8.

## Local development

1. Start the API from `../Backend` with `npm run dev`.
2. Run `npm install` in `Frontend`.
3. Copy `.env.example` to `.env.local` if the API is not at `http://localhost:3000/api`.
4. Run `npm run dev` and open the URL Vite prints (normally `http://localhost:5173`).

For the full PostgreSQL-backed app, run `docker compose up --build` from the repository root and open `http://localhost:8080`. Set the Gemini key in `Backend/.env`; the browser never receives it.

For Vercel, import the repository as a separate project with this folder as the root directory. Set `VITE_API_URL` to the deployed backend URL ending in `/api`, and set the backend `FRONTEND_ORIGIN` to this project's production origin. See `../Backend/README.md` for the API project setup.
