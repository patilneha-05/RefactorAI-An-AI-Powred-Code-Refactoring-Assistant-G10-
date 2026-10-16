# RefactorAI

A FastAPI-based backend for AI-powered code refactoring suggestions.

## Setup

```bash
cd backend

# open-keypool is on TestPyPI — install it separately first
pip install \
  --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  open-keypool

# then install the rest of the dependencies
pip install -r requirements.txt

# optional: test dependencies (pytest)
pip install -r requirements-dev.txt

cp .env.example .env
# edit .env with your Doppler token and a JWT_SECRET (see Authentication below)
python3 main.py
# or
uvicorn main:app --reload
```

Run the frontend (separate terminal):

```bash
cd frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

## API Endpoints

All endpoints below require a valid `Authorization: Bearer <access_token>` header
**except** `/openapi.json` and the dev-only `/_dev_flush_*` helpers.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/open_project` | Open a project (validates path, creates local DB) |
| POST | `/read_file` | Read a file from the active project |
| POST | `/validate_project_path` | Validate a project path exists |
| POST | `/list_projects` | List registered projects |
| POST | `/detect_project_context` | Detect language/framework context for a path |
| POST | `/delete_project` | Delete a registered project |
| POST | `/write_file` | Write file contents into the active project |
| POST | `/refactor` | Trigger refactoring via an agent (validates `agent_id`) |
| POST | `/accept_suggestion` | Accept or reject a suggestion and apply changes |
| GET | `/health` | Liveness probe (unauthenticated) |
| GET | `/openapi.json` | OpenAPI schema (also used as a health check) |
| POST | `/_dev_flush_data` | Dev/test: flush all central DB data (unauthenticated) |
| POST | `/_dev_flush_suggestion` | Dev/test: flush suggestions for a project (unauthenticated) |

### Authentication endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | none | Create account; returns access token + sets refresh cookie |
| POST | `/auth/login` | none | Email/password login |
| POST | `/auth/refresh` | refresh cookie | Rotate refresh token, issue new access token |
| GET | `/auth/me` | bearer | Return the current user |
| POST | `/auth/forgot-password` | none | Always returns a generic message (no account enumeration) |
| POST | `/auth/reset-password` | none | Consume a single-use reset token, set new password |
| POST | `/auth/logout` | bearer | Revoke the refresh session and clear the cookie |
| POST | `/auth/google` | none | Exchange a Google ID token for a RefactorAI session |

## Authentication

RefactorAI uses short-lived JWT **access tokens** plus rotating opaque
**refresh tokens**.

- **Access token** — JWT (HS256, `PyJWT`), lifetime `ACCESS_TOKEN_EXPIRE_MINUTES`
  (default 15 min). Held in memory by the frontend (never `localStorage`).
- **Refresh token** — a random 256-bit opaque string. Only its SHA-256 hash is
  stored in `refresh_tokens`. Delivered as an `HttpOnly` cookie scoped to
  `path=/auth`, with `Secure`/`SameSite` controlled by `COOKIE_SECURE` and
  `COOKIE_SAMESITE`. It is rotated on every refresh and revoked on logout or
  password reset.
- **Passwords** — hashed with `bcrypt`.
- **Password reset** — tokens are random, SHA-256 hashed at rest, short-lived
  (`PASSWORD_RESET_EXPIRE_MINUTES`, default 30) and single-use. After a reset,
  all of a user's refresh sessions are revoked.
- **Rate limiting** — a 60-requests / 300-seconds in-memory sliding window is
  applied to the auth endpoints, keyed by identifier + client IP.
- **Error handling** — login failures return a generic `Invalid credentials`
  message to avoid leaking whether an account exists.

### Request / response shapes

```jsonc
// POST /auth/signup  body
{ "full_name": "Ada Lovelace", "email": "ada@example.com", "password": "at-least-8" }

// POST /auth/login   body
{ "email": "ada@example.com", "password": "at-least-8", "remember_me": false }

// POST /auth/forgot-password body      // always generic response
{ "email": "ada@example.com" }

// POST /auth/reset-password body
{ "token": "<from reset link>", "password": "new-at-least-8" }

// POST /auth/google  body
{ "id_token": "<Google ID token>" }

// Auth success response (signup / login / refresh / google)
{ "user": { "user_id": "…", "full_name": "…", "email": "…", "is_admin": 0 },
  "access_token": "…", "token_type": "bearer" }
```

### Password reset delivery

No email provider is wired up yet. When an account exists the backend logs the
reset link to stdout:

```
[PASSWORD RESET] ada@example.com -> http://localhost:5173/reset-password?token=…
```

Wire an email provider (or `PASSWORD_RESET_FRONTEND_URL` + a mailer) before
production. The response message is identical whether or not the account
exists, so the endpoint is not enumerable.

### Google OAuth setup

Google sign-in is optional and disabled when `GOOGLE_CLIENT_ID` is empty.

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   create an **OAuth 2.0 Client ID → Web application**.
2. Add an authorized JavaScript origin: `http://localhost:5173` (and your
   production origin).
3. Add an authorized redirect URI: `http://localhost:5173/auth/google/callback`.
4. Put the **public** client ID in `frontend/.env` as `VITE_GOOGLE_CLIENT_ID`
   and in `backend/.env` as `GOOGLE_CLIENT_ID`. Put the **client secret** only
   in `backend/.env` as `GOOGLE_CLIENT_SECRET`.

The frontend runs the OAuth implicit flow (popup / redirect, `response_type=id_token`)
with `state` + `nonce`, and sends the resulting ID token to `POST /auth/google`.
The backend verifies the token server-side with
`google.oauth2.id_token.verify_oauth2_token` against `GOOGLE_CLIENT_ID` and
requires a verified email — the client secret is never exposed to the browser.

## Model Config

Agent config is defined in [`backend/agent_config.json`](backend/agent_config.json). Supported `agent_id`:

- `coding-standards-agent-01` — CodingStandardsAgent

## Provider Config

API endpoints for LLM providers are in [`backend/.provider_config.json`](backend/.provider_config.json).

## State

Active project state is tracked in `backend/.state.json`:

```json
{
  "project_id": "<sha256 of project_path>",
  "project_path": "/absolute/path/to/project",
  "project_name": "project-folder-name"
}
```

## Databases

- **Central DB**: `backend/data/.airefactor_central.db` — stores project metadata
- **Local DB**: `<project_path>/.airefactor.db` — stores project_info and suggestions

Auth tables live in the central DB: `users`, `refresh_tokens`, and
`password_reset_tokens` (created automatically on startup).

## Environment variables

### Backend (`backend/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOPPLER_TOKEN` | — | Doppler secrets token (existing) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Browser origins allowed to call the API |
| `CORS_ALLOWED_ORIGIN_REGEX` | `http://(localhost\|127\.0\.0\.1)(:\d+)?` | Extra allowed origins (any local dev port) |
| `JWT_SECRET` | random at startup | **Set in production.** Signing key for access tokens |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh lifetime when "Remember me" is on (1 day otherwise) |
| `PASSWORD_RESET_EXPIRE_MINUTES` | `30` | Reset-token lifetime |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend origin |
| `PASSWORD_RESET_FRONTEND_URL` | `FRONTEND_URL` | Base URL embedded in reset links |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS |
| `COOKIE_SAMESITE` | `lax` | Use `none` (+ `COOKIE_SECURE=true`) for cross-site prod |
| `GOOGLE_CLIENT_ID` | empty | Public Google OAuth client ID (empty disables Google sign-in) |
| `GOOGLE_CLIENT_SECRET` | empty | Backend-only Google client secret |

Generate a secret with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Frontend (`frontend/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000` | Backend base URL |
| `VITE_GOOGLE_CLIENT_ID` | empty | Public Google OAuth client ID (empty hides Google buttons) |

> Never commit real secrets. `.env` / `.env.*` are git-ignored; only
> `.env.example` files are tracked.

## Testing

Backend tests use `pytest` + FastAPI's `TestClient` against an isolated
temporary database (the real central DB is never touched):

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest tests -q
```

The suite covers signup, duplicate/invalid signup, login success and generic
failures, unauthenticated/expired/tampered tokens, refresh rotation and reuse
detection, logout revocation, password reset (non-enumerable, single-use,
expired, session invalidation), Google OAuth (unconfigured, invalid, unverified,
success + account linking), rate limiting, suggestion acceptance (the change is
persisted to the source file on disk, batch line-shifting, rejection leaves the
file untouched), and a regression check of the existing endpoints.

Frontend checks:

```bash
cd frontend
npm run lint      # oxlint
npm run build     # production build
```
