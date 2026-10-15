# RefactorAI Frontend

React + Vite frontend for [RefactorAI](../README.md) — an AI-powered code
refactoring and review platform backed by the FastAPI service in `backend/`.

## Stack

- React 19 + Vite (JavaScript, no TypeScript)
- React Router (navigation), Axios (API), Lucide React (icons)
- Plain CSS design system (`src/styles/`) — no CSS framework

## Setup

```bash
cd frontend
npm install

# point the frontend at the backend (defaults shown)
cp .env.example .env
# VITE_API_BASE_URL=http://127.0.0.1:8000

npm run dev        # http://localhost:5173
```

The backend must be running too:

```bash
cd ../backend
uvicorn main:app --reload   # http://127.0.0.1:8000
```

The backend enables CORS for the Vite dev origins by default
(`CORS_ALLOWED_ORIGINS` in `backend/.env`).

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: active project, API status, session activity |
| `/projects` | Register/open projects, validate folder paths |
| `/workspace` | File explorer + source viewer + agent refactor panel |
| `/suggestions` | Review, accept or reject agent suggestions |
| `/settings` | Backend connection status and configuration help |

## Integrated backend endpoints

`POST /open_project`, `POST /read_file`, `POST /validate_project_path`,
`POST /refactor`, `POST /accept_suggestion`, plus `GET /openapi.json` as a
health check. Development-only endpoints are deliberately not exposed.

## Architecture

```
src/
  components/
    layout/      App shell (sidebar, topbar)
    common/      Button, Input, Modal, Toast, Loader, EmptyState, Badge, StatusPill
    projects/    ProjectCard, OpenProjectForm, PathValidator
    editor/      FileTree, FilePathInput, CodeViewer, RefactorPanel
    suggestions/ SuggestionCard, SuggestionDetails, SuggestionReviewDialog
  pages/         Dashboard, Projects, Workspace, Suggestions, Settings, NotFound
  services/      apiClient + one module per backend endpoint group
  context/       ProjectContext (active project + suggestions), ToastContext, ApiStatusContext
  hooks/         useSuggestionActions, useMediaQuery
  styles/        variables.css (design tokens), global, layout, components, pages
```

The active project and the suggestions returned by `/refactor` are cached in
`localStorage` — the backend has no project-listing or suggestion-listing
endpoint, so this state is kept client-side and synced with
`/accept_suggestion` responses.
