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
| `/login` | Sign in (email/password or Google) |
| `/signup` | Create an account |
| `/forgot-password` | Request a password reset link |
| `/reset-password` | Set a new password from a reset token |
| `/auth/google/callback` | OAuth redirect target for Google sign-in |

All routes except the auth pages above are protected: `ProtectedRoute`
redirects unauthenticated users to `/login`, while `PublicOnlyRoute` keeps
signed-in users away from the auth screens. The backend enforces auth
independently, so the frontend guard is a UX layer only.

## Authentication

- `context/AuthContext.jsx` restores the session on load (via the refresh
  cookie + `/auth/me`) and exposes `login`, `signup`, `loginWithGoogle`, and
  `logout`.
- `services/apiClient.js` attaches the in-memory access token to requests,
  performs a silent refresh (and one retry) on `401`, and throws a structured
  `ApiError`.
- `services/googleOAuth.js` drives the Google OAuth popup/redirect flow.
- The refresh token is an `HttpOnly` cookie set by the backend; the access
  token is kept in memory only and is never written to `localStorage`.

See the [root README](../README.md#authentication) for backend auth details,
environment variables, and Google OAuth setup.

## Integrated backend endpoints

`POST /open_project`, `POST /read_file`, `POST /validate_project_path`,
`POST /refactor`, `POST /accept_suggestion`, plus `GET /openapi.json` as a
health check. Development-only endpoints are deliberately not exposed.

## Architecture

```
src/
  components/
    layout/      App shell (sidebar, topbar)
    common/      Button, Input, Modal, Toast, Loader, EmptyState, Badge, StatusPill, FormMessage
    auth/        AuthLayout, PasswordInput, GoogleSignInButton, ProtectedRoute, AuthLoading
    projects/    ProjectCard, OpenProjectForm, PathValidator
    editor/      FileTree, FilePathInput, CodeViewer, RefactorPanel
    suggestions/ SuggestionCard, SuggestionDetails, SuggestionReviewDialog
  pages/         Dashboard, Projects, Workspace, Suggestions, Settings, NotFound
    auth/        Login, Signup, ForgotPassword, ResetPassword, GoogleOAuthCallback
  routes/        AppRoutes (route table + auth guards)
  services/      apiClient + one module per backend endpoint group
  context/       AuthContext, ProjectContext (active project + suggestions), ToastContext, ApiStatusContext
  hooks/         useSuggestionActions, useMediaQuery
  styles/        variables.css (design tokens), global, layout, components, pages, auth
```

The active project and the suggestions returned by `/refactor` are cached in
`localStorage` — the backend has no suggestion-listing endpoint, so this state
is kept client-side and synced with `/accept_suggestion` responses.

### Suggestions

Accepting a suggestion is not a preview: `POST /accept_suggestion` rewrites the
target line range in the **source file on disk** (and shifts the line numbers of
the remaining pending suggestions in the same batch). The frontend re-reads the
file after an accept, and the Workspace re-reads the open file when it mounts, so
the editor always shows the content that was actually saved. Rejecting only
records the decision — the file is never modified.
