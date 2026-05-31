# Task Synchronization Manager

A local web app that syncs tasks between **Trello** and **Jira** using configurable rules and real-time webhooks. View both boards side-by-side, manage sync mappings, and see recent sync activity in the dashboard.

---

## Tech Stack

| Layer | Stack |
|-------|--------|
| **Frontend** | React 18, Vite, inline styles (`theme.js`) |
| **Backend** | Node.js, Express 4, SQLite |
| **Integrations** | Trello REST API, Jira Cloud REST + Agile API |

---

## Prerequisites

- **Node.js 18+**
- **Trello** API key + token — [trello.com/app-key](https://trello.com/app-key)
- **Jira Cloud** domain, email, API token — [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
- **ngrok** (optional, for live webhook sync) — [ngrok.com](https://ngrok.com/)

---

## Quick Start (Development)

### 1. Backend

```bash
cd backend
npm install
copy .env.example .env   # Windows — use `cp` on macOS/Linux
```

Edit `backend/.env` — at minimum set `PORT=3001`. For automatic sync, also set `WEBHOOK_PUBLIC_URL` and `TRELLO_WEBHOOK_SECRET` (see [SETUP.md](./SETUP.md#5-webhook-setup-live-sync)).

```bash
npm run dev
```

API runs at **http://localhost:3001**. SQLite database is created automatically at `backend/database.sqlite`.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. Vite proxies `/api` to the backend on port 3001.

### 3. Configure the app

1. Create an **environment** with your Trello and Jira credentials.
2. Add **sync rules** (Trello list ↔ Jira column, choose direction).
3. Move a card or issue to test — **Recent Updates** appears in the left panel when webhooks are configured.

---

## Build & Run (Production)

### Build frontend

```bash
cd frontend
npm install
npm run build
```

Static output is written to `frontend/dist/`.

### Preview production build locally

```bash
npm run preview
```

Serves the built UI (default **http://localhost:4173**). The backend must still be running separately.

### Run backend

```bash
cd backend
npm install
npm start
```
---

## npm Scripts

| Location | Command | Description |
|----------|---------|-------------|
| `backend/` | `npm run dev` | Dev server with auto-restart (`:3001`) |
| `backend/` | `npm start` | Production API server |
| `frontend/` | `npm run dev` | Vite dev server (`:5173`) |
| `frontend/` | `npm run build` | Production bundle → `dist/` |
| `frontend/` | `npm run preview` | Serve `dist/` locally |

---

## Project Structure

```text
TaskManagerCurs/
├── backend/
│   ├── server.js           # Express entry point
│   ├── db.js               # SQLite schema
│   ├── routes/             # environments, rules, integrations, webhooks
│   └── services/           # sync engine, Trello/Jira clients
├── frontend/
│   └── src/
│       ├── App.jsx         # View routing (welcome / setup / dashboard)
│       ├── api.js          # fetch wrapper
│       ├── components/     # Dashboard, modals, kanban viewers
│       └── styles/theme.js
```

## Ports

| Service | URL |
|---------|-----|
| Frontend (dev) | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| Frontend (preview) | http://localhost:4173 |
