import hashlib
import json
import os
import re
import fnmatch
import secrets
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List

import bcrypt
import jwt
from fastapi import FastAPI, HTTPException, Depends, Request, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator

from modules.sqlite_io import SQLiteDB
from modules.file_io import read_file_content, replace_file_content, write_file_content
from agent.AgentCommunication import run_agent

load_dotenv()

app = FastAPI(title="RefactorAI")

# CORS — required so the browser frontend (Vite dev server) can call this API.
# Override with a comma-separated list of origins in CORS_ALLOWED_ORIGINS ("*" allows any).
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

# Local-dev convenience: additionally allow any port on localhost / 127.0.0.1, since
# Vite automatically falls back to 5174, 5175, … when 5173 is already taken.
# Set CORS_ALLOWED_ORIGIN_REGEX to an empty string to disable this in production.
ALLOWED_ORIGIN_REGEX = os.environ.get(
    "CORS_ALLOWED_ORIGIN_REGEX",
    r"http://(localhost|127\.0\.0\.1)(:\d+)?",
).strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
CENTRAL_DB_PATH = BASE_DIR / "data" / ".airefactor_central.db"
STATE_FILE = BASE_DIR / ".state.json"


@app.get(
    "/health",
    summary="Health check",
    description=(
        "Lightweight liveness probe used by tooling and manual checks. "
        "Always unauthenticated and does not touch the database."
    ),
    status_code=200,
    responses={200: {"description": "Service is up"}},
)
def health():
    return {"status": "ok"}

# Auth config
JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(32)
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
PASSWORD_RESET_EXPIRE_MINUTES = int(os.environ.get("PASSWORD_RESET_EXPIRE_MINUTES", "30"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
PASSWORD_RESET_FRONTEND_URL = os.environ.get("PASSWORD_RESET_FRONTEND_URL", FRONTEND_URL)

security = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency: validate the JWT access token and return the active user row."""
    _ensure_central_db()
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authentication credentials")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = db.read(
        "users",
        "SELECT * FROM {table} WHERE user_id = ? AND is_active = 1",
        params=(user_id,),
    )
    if err or not rows:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return rows[0]

EXTENSIONS_TO_EXCLUDE = {".pyc", ".pyo", ".pyd", ".so", ".dll", ".exe", ".bin"}

def _ensure_central_db():
    os.makedirs(CENTRAL_DB_PATH.parent, exist_ok=True)
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS projects (
            project_id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            project_name TEXT NOT NULL,
            github_url TEXT,
            createdby TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            oauth_provider TEXT,
            oauth_provider_id TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )"""
    )
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )"""
    )


def _compute_project_id(project_path: str) -> str:
    return hashlib.sha256(project_path.encode("utf-8")).hexdigest()


def _build_file_tree(folder_path: str) -> dict:
    """Recursively build a file/folder tree dict. Excludes dotfiles."""
    tree: dict = {}
    try:
        entries = sorted(os.scandir(folder_path), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return tree

    for entry in entries:
        name = entry.name
        if name.startswith("."):
            continue
        if entry.is_dir():
            tree[name] = _build_file_tree(entry.path)
        else:
            ext = os.path.splitext(name)[1]
            if ext not in EXTENSIONS_TO_EXCLUDE:
                tree[name] = None  # None marks a file
    return tree


def _parse_gitignore(project_path: str) -> list[str]:
    gitignore_path = os.path.join(project_path, ".gitignore")
    patterns = []
    if not os.path.isfile(gitignore_path):
        return patterns
    try:
        with open(gitignore_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                patterns.append(line)
    except Exception:
        pass
    return patterns


def _is_ignored(rel_path: str, is_dir: bool, gitignore_patterns: list[str]) -> bool:
    name = os.path.basename(rel_path)
    for pattern in gitignore_patterns:
        p = pattern.rstrip("/")
        is_dir_pattern = pattern.endswith("/")
        if is_dir_pattern and not is_dir:
            continue
        if fnmatch.fnmatch(name, p):
            return True
        if fnmatch.fnmatch(rel_path, p):
            return True
    return False


def _read_all_project_files(project_path: str, gitignore_patterns: list[str]) -> dict:
    file_contents = {}
    for root, dirs, files in os.walk(project_path):
        rel_root = os.path.relpath(root, project_path)
        if rel_root == ".":
            rel_root = ""

        dirs_to_remove = []
        for d in dirs:
            rel_dir = os.path.join(rel_root, d) if rel_root else d
            if d.startswith(".") or _is_ignored(rel_dir, True, gitignore_patterns):
                dirs_to_remove.append(d)
        for d in dirs_to_remove:
            dirs.remove(d)

        for fname in files:
            if fname.startswith(".") and fname != ".gitignore":
                continue
            ext = os.path.splitext(fname)[1]
            if ext in EXTENSIONS_TO_EXCLUDE:
                continue
            rel_file = os.path.join(rel_root, fname) if rel_root else fname
            if _is_ignored(rel_file, False, gitignore_patterns):
                continue
            full_path = os.path.join(root, fname)
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                file_contents[rel_file] = content
            except Exception:
                file_contents[rel_file] = "<UNREADABLE: binary or permission error>"
    return file_contents


# --------------------------------------------------------------------------- #
# Project context auto-detection
# --------------------------------------------------------------------------- #

# Directories that are almost never part of a project's own source.
_DETECT_SKIP_DIRS = {
    "node_modules", "bower_components", "venv", ".venv", "env", "__pycache__",
    "dist", "build", "out", "target", "vendor", "coverage", "bin", "obj",
    ".next", ".nuxt", ".svelte-kit", ".dart_tool", "Pods", ".terraform",
    ".gradle", ".mypy_cache", ".pytest_cache", ".ruff_cache",
}

_MAX_SCAN_FILES = 20000
_MAX_SCAN_DEPTH = 12

# Source extension → canonical language name.
_LANGUAGE_BY_EXT = {
    ".py": "Python", ".pyi": "Python",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
    ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
    ".cs": "C#", ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
    ".swift": "Swift", ".dart": "Dart", ".scala": "Scala", ".sh": "Shell",
    ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "LESS",
    ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte", ".ex": "Elixir", ".exs": "Elixir",
    ".lua": "Lua", ".pl": "Perl", ".clj": "Clojure", ".fs": "F#", ".r": "R",
}

# npm dependency → human label (frameworks / tooling).
_JS_PACKAGES = {
    "react": "React", "react-dom": "React", "next": "Next.js", "vue": "Vue",
    "nuxt": "Nuxt", "@angular/core": "Angular", "svelte": "Svelte",
    "@sveltejs/kit": "SvelteKit", "solid-js": "SolidJS", "express": "Express",
    "koa": "Koa", "@nestjs/core": "NestJS", "fastify": "Fastify",
    "vite": "Vite", "webpack": "Webpack", "typescript": "TypeScript",
    "tailwindcss": "Tailwind CSS", "redux": "Redux", "zustand": "Zustand",
    "axios": "Axios", "jest": "Jest", "vitest": "Vitest", "eslint": "ESLint",
    "electron": "Electron", "three": "Three.js", "socket.io": "Socket.IO",
    "graphql": "GraphQL", "prisma": "Prisma",
}

# Python dependency (substring) → human label.
_PY_FRAMEWORKS = {
    "fastapi": "FastAPI", "django": "Django", "flask": "Flask", "starlette": "Starlette",
    "sqlalchemy": "SQLAlchemy", "pydantic": "Pydantic", "uvicorn": "Uvicorn",
    "celery": "Celery", "pytest": "pytest", "pandas": "pandas", "numpy": "NumPy",
    "scipy": "SciPy", "torch": "PyTorch", "tensorflow": "TensorFlow",
    "streamlit": "Streamlit", "scrapy": "Scrapy", "aiohttp": "aiohttp",
    "jinja2": "Jinja2", "alembic": "Alembic", "boto3": "boto3 (AWS)",
}

# Dependency → database label.
# npm entries match exact package names; Python entries match substrings.
_JS_DB_PACKAGES = {
    "pg": "PostgreSQL", "postgres": "PostgreSQL", "mysql": "MySQL",
    "mysql2": "MySQL", "mongodb": "MongoDB", "mongoose": "MongoDB",
    "redis": "Redis", "ioredis": "Redis", "sqlite3": "SQLite",
    "better-sqlite3": "SQLite",
}
_PY_DB_HINTS = {
    "psycopg": "PostgreSQL", "asyncpg": "PostgreSQL",
    "mysqlclient": "MySQL", "pymysql": "MySQL",
    "pymongo": "MongoDB", "mongoengine": "MongoDB",
    "redis": "Redis", "sqlite3": "SQLite",
}


def _read_text(path: str, limit: int = 200_000) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except Exception:
        return ""


def _readme_summary(folder_path: str) -> str:
    for name in ("README.md", "readme.md", "Readme.md", "README.rst", "README.txt"):
        path = os.path.join(folder_path, name)
        if not os.path.isfile(path):
            continue
        for raw in _read_text(path, 20000).splitlines():
            line = raw.strip()
            if not line or line.startswith(("#", "!", "<", "---", "===", "[![")):
                continue
            line = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", line)  # markdown links
            line = re.sub(r"[*_`]+", "", line)  # emphasis / inline code
            line = line.strip("#> ").strip()
            if len(line) >= 12:
                return line[:300]
    return ""


def _detect_project_context(folder_path: str) -> dict:
    """Best-effort description of a folder, used to pre-fill `project_context`.

    Never raises: an unreadable or missing folder yields an empty dict.
    """
    folder_path = os.path.abspath(folder_path)
    if not os.path.isdir(folder_path):
        return {}

    gitignore = _parse_gitignore(folder_path)

    lang_counts: dict = {}
    rel_files: set = set()
    dir_count = 0
    file_count = 0
    exceeded = False

    for root, dirs, files in os.walk(folder_path):
        rel_root = os.path.relpath(root, folder_path)
        if rel_root == ".":
            rel_root = ""
        if rel_root and rel_root.count(os.sep) >= _MAX_SCAN_DEPTH:
            dirs[:] = []
            continue

        prune = []
        for name in dirs:
            if name.startswith(".") or name in _DETECT_SKIP_DIRS:
                prune.append(name)
                continue
            rel_dir = os.path.join(rel_root, name) if rel_root else name
            if _is_ignored(rel_dir, True, gitignore):
                prune.append(name)
        for name in prune:
            dirs.remove(name)
        dir_count += len(dirs)

        for fname in files:
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in EXTENSIONS_TO_EXCLUDE:
                continue
            rel_file = os.path.join(rel_root, fname) if rel_root else fname
            if _is_ignored(rel_file, False, gitignore):
                continue
            file_count += 1
            rel_files.add(rel_file)
            language = _LANGUAGE_BY_EXT.get(ext)
            if language:
                lang_counts[language] = lang_counts.get(language, 0) + 1
            if file_count >= _MAX_SCAN_FILES:
                exceeded = True
                break
        if exceeded:
            break

    technologies: list = []
    frameworks: list = []
    databases: list = []

    def add_tech(name):
        if name and name not in technologies:
            technologies.append(name)

    def add_framework(name):
        if name and name not in frameworks:
            frameworks.append(name)
            add_tech(name)

    def add_db(name):
        if name and name not in databases:
            databases.append(name)
            add_tech(name)

    # --- Node / JavaScript ------------------------------------------------- #
    js_deps: dict = {}
    package_description = ""
    pkg_path = os.path.join(folder_path, "package.json")
    if os.path.isfile(pkg_path):
        add_tech("Node.js")
        try:
            pkg = json.loads(_read_text(pkg_path) or "{}")
        except (json.JSONDecodeError, TypeError):
            pkg = {}
        if isinstance(pkg, dict):
            for section in ("dependencies", "devDependencies", "peerDependencies"):
                section_deps = pkg.get(section)
                if isinstance(section_deps, dict):
                    js_deps.update(section_deps)
            pkg_description = pkg.get("description")
            if isinstance(pkg_description, str):
                package_description = pkg_description.strip()
        for dep, label in _JS_PACKAGES.items():
            if dep in js_deps:
                add_framework(label)

    # --- Python ------------------------------------------------------------ #
    py_deps_text = ""
    for manifest in ("requirements.txt", "requirements-dev.txt", "pyproject.toml",
                     "Pipfile", "setup.py", "setup.cfg"):
        manifest_path = os.path.join(folder_path, manifest)
        if os.path.isfile(manifest_path):
            add_tech("Python")
            py_deps_text += "\n" + _read_text(manifest_path).lower()
    for key, label in _PY_FRAMEWORKS.items():
        if key in py_deps_text:
            add_framework(label)

    # --- Databases (mentioned in any dependency manifest) ------------------ #
    for dep, label in _JS_DB_PACKAGES.items():
        if dep in js_deps:
            add_db(label)
    for hint, label in _PY_DB_HINTS.items():
        if hint in py_deps_text:
            add_db(label)

    # --- Other ecosystems --------------------------------------------------
    if os.path.isfile(os.path.join(folder_path, "go.mod")):
        add_tech("Go")
    cargo_path = os.path.join(folder_path, "Cargo.toml")
    if os.path.isfile(cargo_path):
        add_tech("Rust")
        cargo = _read_text(cargo_path).lower()
        for key, label in (("actix", "Actix"), ("axum", "Axum"), ("tokio", "Tokio")):
            if key in cargo:
                add_framework(label)
    for java_manifest in ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"):
        java_path = os.path.join(folder_path, java_manifest)
        if os.path.isfile(java_path):
            add_tech("Java")
            if "spring" in _read_text(java_path).lower():
                add_framework("Spring Boot")
    composer_path = os.path.join(folder_path, "composer.json")
    if os.path.isfile(composer_path):
        add_tech("PHP")
        composer = _read_text(composer_path).lower()
        for key, label in (("laravel", "Laravel"), ("symfony", "Symfony")):
            if key in composer:
                add_framework(label)
    gemfile_path = os.path.join(folder_path, "Gemfile")
    if os.path.isfile(gemfile_path):
        add_tech("Ruby")
        if "rails" in _read_text(gemfile_path).lower():
            add_framework("Ruby on Rails")
    if any(name.endswith((".csproj", ".sln")) for name in rel_files):
        add_tech(".NET")
    if os.path.isfile(os.path.join(folder_path, "pubspec.yaml")):
        add_tech("Dart")
        add_framework("Flutter")
    if any(
        os.path.isfile(os.path.join(folder_path, name))
        for name in ("Dockerfile", "docker-compose.yml", "docker-compose.yaml")
    ):
        add_tech("Docker")
    if any(name.endswith(".tf") for name in rel_files):
        add_tech("Terraform")

    # Languages observed in the tree (skip ones already listed).
    for language, _count in sorted(lang_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        add_tech(language)

    description = package_description or _readme_summary(folder_path)
    if not description:
        primary = max(lang_counts, key=lang_counts.get) if lang_counts else None
        if primary:
            description = (
                f"{primary} project — {file_count} source file"
                f"{'s' if file_count != 1 else ''} across {dir_count} folders."
            )

    context: dict = {}
    if technologies:
        context["technology"] = ", ".join(technologies[:8])
    if description:
        context["description"] = description
    if lang_counts:
        top = sorted(lang_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:6]
        context["languages"] = ", ".join(f"{name} ({count})" for name, count in top)
    if frameworks:
        context["frameworks"] = ", ".join(frameworks[:8])
    if databases:
        context["databases"] = ", ".join(databases[:6])
    context["source_files"] = file_count
    context["folders"] = dir_count
    return context


def _build_project_context_for_agent(project_id: str) -> str:
    if not STATE_FILE.is_file():
        raise HTTPException(status_code=400, detail="No active project. Call /open_project first.")

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    if state.get("project_id") != project_id:
        raise HTTPException(status_code=400, detail="project_id does not match active project")

    project_path = state["project_path"]

    local_db_path = os.path.join(project_path, ".airefactor.db")
    if not os.path.isfile(local_db_path):
        raise HTTPException(status_code=404, detail="Project local DB not found")

    db = SQLiteDB(local_db_path)

    db.runQuery(
        "UPDATE {table} SET suggestion_state = ? WHERE suggestion_state = ?",
        table_name="suggestions",
        params=("discarded-[user_refresh]", "pending"),
    )

    project_context = {}
    err, rows = db.read(
        "project_info",
        "SELECT project_context FROM {table} WHERE project_id = ?",
        params=(project_id,),
    )
    if not err and rows and rows[0].get("project_context"):
        try:
            project_context = json.loads(rows[0]["project_context"])
        except (json.JSONDecodeError, TypeError):
            pass

    gitignore_patterns = _parse_gitignore(project_path)
    file_contents = _read_all_project_files(project_path, gitignore_patterns)

    err, all_suggestions = db.read(
        "suggestions",
        "SELECT suggestion_description, line_no_from, line_no_to, old_lines, "
        "replace_by, agent_id, batch_id, suggestion_state FROM {table} "
        "ORDER BY created_at ASC",
    )
    if err:
        all_suggestions = []

    output_parts = []

    output_parts.append("PROJECT_CONTEXT:")
    output_parts.append(json.dumps(project_context, indent=2, ensure_ascii=False))
    output_parts.append("")

    output_parts.append("PROJECT_FILE_CONTENT:")
    output_parts.append(json.dumps(list(file_contents.keys()), indent=2, ensure_ascii=False))
    output_parts.append("")

    for fname, content in sorted(file_contents.items()):
        output_parts.append(f"FILE_NAME: {fname}")
        output_parts.append(content)
        output_parts.append("")

    output_parts.append("PREVIOUS_SUGGESTIONS:")
    output_parts.append(json.dumps(all_suggestions, indent=2, ensure_ascii=False, default=str))

    return "\n".join(output_parts)


def _create_project_local_db(folder_path: str, project_id: str, project_name: str,
                              github_url: Optional[str], createdby: str,
                              project_context: Optional[dict] = None):
    db_path = os.path.join(folder_path, ".airefactor.db")
    db = SQLiteDB(db_path)
    now = datetime.now(timezone.utc).isoformat()
    context_json = json.dumps(project_context) if project_context is not None else None
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS project_info (
            project_id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            project_name TEXT NOT NULL,
            github_url TEXT,
            createdby TEXT NOT NULL,
            project_context TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    db.runQuery(
        """INSERT OR REPLACE INTO project_info
           (project_id, project_path, project_name, github_url, createdby, project_context, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        params=(project_id, folder_path, project_name, github_url, createdby, context_json, now, now),
    )
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS suggestions (
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            suggestion_id TEXT PRIMARY KEY,
            suggestion_description TEXT NOT NULL,
            line_no_from INTEGER NOT NULL,
            line_no_to INTEGER NOT NULL,
            old_lines TEXT NOT NULL,
            replace_by TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            batch_id TEXT NOT NULL,
            suggestion_state TEXT NOT NULL
        )"""
    )


class OpenProjectRequest(BaseModel):
    is_new: bool
    project_name: Optional[str] = None
    folder_path: Optional[str] = None
    project_id: Optional[str] = None
    project_context: Optional[dict] = None


class OpenProjectResponse(BaseModel):
    project_id: str
    project_name: str
    project_path: str
    new_project: bool
    tree: dict


@app.post(
    "/open_project",
    summary="Open or register a project",
    description=(
        "Opens an existing project or registers a new one. "
        "When `is_new` is true, creates entries in both the central database and "
        "a local `.airefactor.db` inside the project folder. "
        "Always writes the current project state to `.state.json` and returns the "
        "full file/folder tree of the project (excluding dotfiles and compiled binaries)."
    ),
    response_model=OpenProjectResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "Invalid folder_path or missing required parameter"},
        401: {"description": "Not authenticated"},
        500: {"description": "Internal database error"},
    },
)
def open_project(req: OpenProjectRequest):
    _ensure_central_db()

    central_db = SQLiteDB(str(CENTRAL_DB_PATH))

    if not req.is_new:
        if not req.project_id:
            raise HTTPException(status_code=400, detail="project_id is required when is_new is false")

        err, rows = central_db.read(
            "projects",
            "SELECT * FROM {table} WHERE project_id = ?",
            params=(req.project_id,),
        )
        if err:
            raise HTTPException(status_code=500, detail="Database read error")
        if not rows:
            raise HTTPException(status_code=404, detail="Project not found in central DB")

        project = rows[0]
        project_id = project["project_id"]
        project_name = project["project_name"]
        folder_path = project["project_path"]

        now = datetime.now(timezone.utc).isoformat()
        central_db.runQuery(
            "UPDATE {table} SET updated_at = ? WHERE project_id = ?",
            table_name="projects",
            params=(now, project_id),
        )

        if not os.path.isdir(folder_path):
            raise HTTPException(status_code=400, detail="Project path no longer exists on disk")

        state = {
            "project_id": project_id,
            "project_path": folder_path,
            "project_name": project_name,
        }
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)

        tree = _build_file_tree(folder_path)
        return {
            "project_id": project_id,
            "project_name": project_name,
            "project_path": folder_path,
            "new_project": False,
            "tree": tree,
        }

    if not req.folder_path:
        raise HTTPException(status_code=400, detail="folder_path is required when is_new is true")
    if not req.project_name:
        raise HTTPException(status_code=400, detail="project_name is required when is_new is true")
    if req.project_context is None:
        raise HTTPException(status_code=400, detail="project_context is required when is_new is true")

    folder_path = os.path.abspath(req.folder_path)
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail="folder_path is not a valid directory")

    project_id = _compute_project_id(folder_path)
    project_name = req.project_name
    github_url: Optional[str] = None
    createdby = "local"

    err, rows = central_db.read(
        "projects",
        "SELECT * FROM {table} WHERE project_id = ?",
        params=(project_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")

    is_new_project = len(rows) == 0
    now = datetime.now(timezone.utc).isoformat()

    err, _ = central_db.runQuery(
        """INSERT OR REPLACE INTO projects
           (project_id, project_path, project_name, github_url, createdby, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        params=(project_id, folder_path, project_name, github_url, createdby, now, now),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to insert project into central DB")

    _create_project_local_db(
        folder_path, project_id, project_name, github_url, createdby,
        project_context=req.project_context,
    )

    state = {
        "project_id": project_id,
        "project_path": folder_path,
        "project_name": project_name,
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

    tree = _build_file_tree(folder_path)

    return {
        "project_id": project_id,
        "project_name": project_name,
        "project_path": folder_path,
        "new_project": is_new_project,
        "tree": tree,
    }


class ReadFileRequest(BaseModel):
    filename: str


class ReadFileResponse(BaseModel):
    project_id: str
    filename: str
    total_lines: int
    lines: dict[int, str]
    ends_with_newline: bool = False


@app.post(
    "/read_file",
    summary="Read a file from the active project",
    description=(
        "Returns the contents of a file inside the currently active project "
        "(stored in `.state.json` by `/open-project`) with line numbers. "
        "The `filename` is relative to the project root (e.g. `src/main.py`)."
    ),
    response_model=ReadFileResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "No active project in .state.json"},
        404: {"description": "File not found"},
        500: {"description": "Failed to read file"},
    },
)
def read_file(req: ReadFileRequest):
    if not STATE_FILE.is_file():
        raise HTTPException(status_code=400, detail="No active project. Call /open-project first.")

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    project_id = state["project_id"]
    project_path = state["project_path"]
    file_path = os.path.join(project_path, req.filename)

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        result = read_file_content(file_path)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read file")

    return {
        "project_id": project_id,
        "filename": req.filename,
        "total_lines": result["total_lines"],
        "lines": result["lines"],
        "ends_with_newline": result["ends_with_newline"],
    }


class WriteFileRequest(BaseModel):
    project_id: str
    filename: str
    content: str


class WriteFileResponse(BaseModel):
    project_id: str
    filename: str
    total_lines: int
    bytes_written: int


@app.post(
    "/write_file",
    summary="Save edited file content back to disk",
    description=(
        "Overwrites a file that already exists inside the active project with the "
        "supplied text. `project_id` must match the active project, and `filename` "
        "must resolve to a path inside the project root — path traversal is "
        "rejected. Added for the workspace's editable code editor."
    ),
    response_model=WriteFileResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "Missing filename or project mismatch / path escapes the project"},
        404: {"description": "File not found"},
        500: {"description": "Failed to write file"},
    },
)
def write_file(req: WriteFileRequest):
    if not os.path.isfile(STATE_FILE):
        raise HTTPException(status_code=400, detail="No active project — open one first")
    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    if state.get("project_id") != req.project_id:
        raise HTTPException(status_code=400, detail="project_id does not match active project")

    if not req.filename or not req.filename.strip():
        raise HTTPException(status_code=400, detail="filename is required")

    project_root = os.path.realpath(state["project_path"])
    target = os.path.realpath(os.path.join(project_root, req.filename))

    if target != project_root and not target.startswith(project_root + os.sep):
        raise HTTPException(status_code=400, detail="filename escapes the project root")

    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        result = write_file_content(target, req.content)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to write file")

    return {
        "project_id": req.project_id,
        "filename": req.filename,
        "total_lines": result["total_lines"],
        "bytes_written": len(req.content.encode("utf-8")),
    }


class ValidateProjectPathRequest(BaseModel):
    folder_path: str


class ValidateProjectPathResponse(BaseModel):
    exists_in_db: bool
    path_exists: bool
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    project_path: Optional[str] = None


@app.post(
    "/validate_project_path",
    summary="Check if a folder path is a registered project or exists on disk",
    description=(
        "Checks whether the given folder path is already registered in the central "
        "database. If found, returns the stored project info. If not found, checks "
        "whether the path exists on the filesystem and reports accordingly."
    ),
    response_model=ValidateProjectPathResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "Invalid or empty folder_path"},
        500: {"description": "Database read error"},
    },
)
def validate_project_path(req: ValidateProjectPathRequest):
    _ensure_central_db()

    if not req.folder_path:
        raise HTTPException(status_code=400, detail="folder_path is required")

    folder_path = os.path.abspath(req.folder_path)
    path_exists = os.path.isdir(folder_path)

    project_id = _compute_project_id(folder_path)

    central_db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = central_db.read(
        "projects",
        "SELECT * FROM {table} WHERE project_id = ?",
        params=(project_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")

    if rows:
        return {
            "exists_in_db": True,
            "path_exists": True,
            "project_id": rows[0]["project_id"],
            "project_name": rows[0]["project_name"],
            "project_path": rows[0]["project_path"],
        }

    return {
        "exists_in_db": False,
        "path_exists": path_exists,
        "project_id": None,
        "project_name": None,
        "project_path": None,
    }


class DetectContextRequest(BaseModel):
    folder_path: str


class DetectContextResponse(BaseModel):
    folder_path: str
    exists: bool
    project_context: dict


@app.post(
    "/detect_project_context",
    summary="Auto-detect a folder's project context",
    description=(
        "Scans a folder on the backend machine and returns a suggested "
        "`project_context` (technology, description, languages, frameworks, "
        "databases, file/folder counts). Used by the frontend to pre-fill the "
        "context dialog before a project is registered. Read-only: it never "
        "registers the project or writes anything."
    ),
    response_model=DetectContextResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={400: {"description": "folder_path is required"}},
)
def detect_project_context(req: DetectContextRequest):
    if not req.folder_path:
        raise HTTPException(status_code=400, detail="folder_path is required")

    folder_path = os.path.abspath(req.folder_path)
    exists = os.path.isdir(folder_path)
    context = _detect_project_context(folder_path) if exists else {}
    return {
        "folder_path": folder_path,
        "exists": exists,
        "project_context": context,
    }


class ListProjectsRequest(BaseModel):
    """Empty body is accepted so the endpoint stays consistent with the rest of
    the POST-only API (avoids preflight differences across browsers)."""


class ListProjectsResponse(BaseModel):
    projects: list[dict] = []


@app.post(
    "/list_projects",
    summary="List every project registered in the central database",
    description=(
        "Returns projects from the backend's central database, most recently "
        "updated first. Added for the frontend launcher's Recent Projects table. "
        "Purely additive — it does not alter any existing endpoint."
    ),
    response_model=ListProjectsResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={500: {"description": "Database read error"}},
)
def list_projects():
    _ensure_central_db()
    central_db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = central_db.read(
        "projects",
        "SELECT project_id, project_path, project_name, github_url, "
        "created_at, updated_at FROM {table} ORDER BY updated_at DESC",
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")
    return {"projects": rows or []}


class DeleteProjectRequest(BaseModel):
    project_id: str


class DeleteProjectResponse(BaseModel):
    deleted: bool
    project_id: str


@app.post(
    "/delete_project",
    summary="Remove a project registration from the central database",
    description=(
        "Deletes the project row from the central database and clears the active "
        "project pointer if it referenced this project. It NEVER touches the "
        "project's files on disk. Added for the frontend launcher's Recent "
        "Projects 'remove' action. Purely additive."
    ),
    response_model=DeleteProjectResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "project_id is required"},
        404: {"description": "Project not found in central DB"},
        500: {"description": "Database error"},
    },
)
def delete_project(req: DeleteProjectRequest):
    _ensure_central_db()

    if not req.project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    central_db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = central_db.read(
        "projects",
        "SELECT project_id FROM {table} WHERE project_id = ?",
        params=(req.project_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found in central DB")

    err, _ = central_db.runQuery(
        "DELETE FROM {table} WHERE project_id = ?",
        table_name="projects",
        params=(req.project_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to delete project")

    # Drop the active-project pointer if it referenced the removed project.
    # Only the pointer is cleared — the project folder is left untouched.
    try:
        if STATE_FILE.is_file():
            with open(STATE_FILE, "r") as f:
                state = json.load(f)
            if state.get("project_id") == req.project_id:
                os.remove(STATE_FILE)
    except Exception:
        pass

    return {"deleted": True, "project_id": req.project_id}


class RefactorRequest(BaseModel):
    project_id: str
    filename: str
    agent_id: str
    user_message: str = "Review this file for coding standards issues."


class RefactorResponse(BaseModel):
    success: bool
    agent: str
    suggestions: Optional[list[dict]] = None
    model: str
    error: Optional[dict] = None
    # Present only when an agent returned prose instead of suggestions
    # (e.g. InformationAgent's explanation).
    output: Optional[str] = None


def _get_agent_config_by_id(agent_id: str) -> Optional[dict]:
    agent_config_path = BASE_DIR / "agent_config.json"
    try:
        with open(agent_config_path, "r") as f:
            config = json.load(f)
    except Exception:
        return None

    for agent_name, agent_config in config.items():
        if agent_config.get("agent_id") == agent_id:
            result = dict(agent_config)
            result["config_key"] = agent_name
            return result
    return None


def _run_agent_flow(project_id: str, filename: str, agent_name: str, project_context: dict, user_message: str):
    if not STATE_FILE.is_file():
        raise HTTPException(status_code=400, detail="No active project. Call /open_project first.")

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    if state.get("project_id") != project_id:
        raise HTTPException(status_code=400, detail="project_id does not match active project")

    project_path = state["project_path"]
    file_path = os.path.join(project_path, filename)

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=400, detail="File not found in project")

    try:
        file_content = read_file_content(file_path)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read file")

    code_file = {
        "filename": filename,
        "total_lines": file_content["total_lines"],
        "lines": file_content["lines"],
    }

    if not os.environ.get("COMPLETE_PROJECT_CONTEXT", "false").lower() in ("true", "1", "yes"):
        local_db_path = os.path.join(project_path, ".airefactor.db")
        if os.path.isfile(local_db_path):
            local_db = SQLiteDB(local_db_path)
            err, rows = local_db.read(
                "project_info",
                "SELECT project_context FROM {table} WHERE project_id = ?",
                params=(state["project_id"],),
            )
            if not err and rows and rows[0].get("project_context"):
                try:
                    project_context = json.loads(rows[0]["project_context"])
                except (json.JSONDecodeError, TypeError):
                    pass

    result = run_agent(
        agent_name=agent_name,
        prompt=user_message,
        project_context=project_context,
        git_context={},
        code_file=code_file,
        api_key=str(os.getenv("GROQ_API_KEY")),
    )

    err_type = (result.get("error") or {}).get("type", "")

    if result["success"]:
        suggestions = result.get("suggestions", [])
        update_suggestions(project_path, result["agent"], suggestions)
        response = {
            "success": True,
            "agent": result["agent"],
            "suggestions": suggestions,
            "model": result.get("model", ""),
            "error": {
                "type": err_type,
                "message": result.get("error", {}).get("message", ""),
            },
        }
        # Informational agents (e.g. InformationAgent) return prose instead of a
        # suggestion list; expose their raw output only when there is nothing
        # structured, so the regular coding-agent responses stay lean.
        if not suggestions:
            response["output"] = result.get("output")
        return response
    elif err_type == "AuthenticationError":
        return {
            "success": False,
            "agent": result["agent"],
            "model": result.get("model", ""),
            "error": {
                "type": err_type,
                "message": result.get("error", {}).get("message", ""),
            }
        }
    elif err_type == "APIStatusError" and "429" in (result.get("error") or {}).get("message", ""):
        return {
            "success": False,
            "agent": result["agent"],
            "model": result.get("model", ""),
            "error": {
                "type": err_type,
                "message": result.get("error", {}).get("message", ""),
            }
        }
    else:
        return {
            "success": False,
            "error" : {
                "Internal Server Error": result.get("error", {}).get("message", "Unknown error occurred")
            }
        }

@app.post(
    "/refactor",
    summary="Trigger a refactor on a file",
    description=(
        "Analyzes the specified file in the active project and returns suggestions "
        "from the requested agent after validating the agent_id against agent_config.json."
    ),
    response_model=RefactorResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "Invalid agent_id or active project mismatch"},
        404: {"description": "Project or file not found"},
        500: {"description": "Internal error during refactoring"},
    },
)
def refactor(req: RefactorRequest):
    agent_config = _get_agent_config_by_id(req.agent_id)
    if not agent_config:
        raise HTTPException(status_code=400, detail="Invalid agent_id")

    project_context = {}
    if os.environ.get("COMPLETE_PROJECT_CONTEXT", "false").lower() in ("true", "1", "yes"):
        project_context = _build_project_context_for_agent(req.project_id)

    return _run_agent_flow(req.project_id, req.filename, agent_config["config_key"], project_context, req.user_message)

# (/_dev_flush-data) DEV/TEST MODEL/ENDPOINTS (not for final use)
@app.post(
    "/_dev_flush_data",
    summary="Flush all data from the central database",
    description=(
        "Drops and recreates every table in `.airefactor_central.db`, "
        "wiping all stored projects. **For development/testing only.**"
    ),
    status_code=200,
    responses={
        200: {"description": "All tables flushed successfully"},
    },
)
def dev_flush_data():
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    db.runQuery("DELETE FROM projects")
    return {"status": "ok", "message": "All data flushed from central DB"}

# (/_dev_flush_suggestion) DEV/TEST MODEL/ENDPOINTS (not for final use)
class FlushSuggestionsRequest(BaseModel):
    project_id: str

# (/_dev_flush_suggestion) DEV/TEST MODEL/ENDPOINTS (not for final use)
@app.post(
    "/_dev_flush_suggestion",
    summary="Flush all suggestions from a project's local database",
    description=(
        "Deletes all rows from the `suggestions` table in the project's "
        "local `.airefactor.db`. **For development/testing only.**"
    ),
    status_code=200,
    responses={
        404: {"description": "Project not found in central DB"},
        500: {"description": "Database error"},
    },
)
def dev_flush_suggestions(req: FlushSuggestionsRequest):
    _ensure_central_db()
    central_db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = central_db.read(
        "projects",
        "SELECT * FROM {table} WHERE project_id = ?",
        params=(req.project_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")

    project_path = rows[0]["project_path"]
    local_db_path = os.path.join(project_path, ".airefactor.db")
    if not os.path.isfile(local_db_path):
        raise HTTPException(status_code=404, detail="Project local DB not found")

    db = SQLiteDB(local_db_path)
    db.runQuery("DELETE FROM suggestions")
    return {"status": "ok", "message": "All suggestions flushed"}


def update_suggestions(project_path: str, agent_id: str, suggestions: list[dict]):
    local_db_path = os.path.join(project_path, ".airefactor.db")
    db = SQLiteDB(local_db_path)
    db.runQuery(
        """CREATE TABLE IF NOT EXISTS suggestions (
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            suggestion_id TEXT PRIMARY KEY,
            suggestion_description TEXT NOT NULL,
            line_no_from INTEGER NOT NULL,
            line_no_to INTEGER NOT NULL,
            old_lines TEXT NOT NULL,
            replace_by TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            batch_id TEXT NOT NULL,
            suggestion_state TEXT NOT NULL
        )"""
    )
    for s in suggestions:
        db.runQuery(
            """INSERT OR REPLACE INTO suggestions
               (suggestion_id, suggestion_description, line_no_from, line_no_to,
                old_lines, replace_by, agent_id, batch_id, suggestion_state)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            params=(
                s.get("suggestion_id", ""),
                s.get("suggestion_description", ""),
                s.get("line_no_from", 0),
                s.get("line_no_to", 0),
                s.get("old_lines", ""),
                s.get("replace_by", ""),
                agent_id,
                s.get("batch_id", "ERBTCH"),
                s.get("suggestion_state", "pending"),
            ),
        )


class AcceptSuggestionRequest(BaseModel):
    project_id: str
    filename: str
    suggestion_id: str
    batch_id: str
    accept: bool


class AcceptSuggestionResponse(BaseModel):
    success: bool
    accepted: bool
    suggestion_id: str
    batch_id: str
    adjustment: Optional[dict] = None
    remaining_suggestions: list[dict] = []
    message: str = ""


def _shift_pending_line_numbers(
    db: SQLiteDB,
    accepted_to: int,
    extra: int,
    batch_id: str,
    exclude_suggestion_id: str,
):
    """
    Shift line_no_from/line_no_to for remaining pending suggestions in the same batch.
    Only suggestions entirely after the accepted range (line_no_from > accepted_to) are shifted.
    """
    if extra == 0:
        return

    err, rows = db.read(
        "suggestions",
        "SELECT suggestion_id, line_no_from, line_no_to FROM {table} "
        "WHERE suggestion_state = ? AND batch_id = ? AND suggestion_id != ?",
        params=("pending", batch_id, exclude_suggestion_id),
    )
    if err or not rows:
        return

    for row in rows:
        lnf = int(row["line_no_from"])
        lnt = int(row["line_no_to"])
        if lnf > accepted_to:
            new_lnf = max(1, lnf + extra)
            new_lnt = max(new_lnf, lnt + extra)
            db.runQuery(
                "UPDATE {table} SET line_no_from = ?, line_no_to = ? WHERE suggestion_id = ?",
                table_name="suggestions",
                params=(new_lnf, new_lnt, row["suggestion_id"]),
            )


def _get_pending_suggestions_by_batch(
    db: SQLiteDB,
    batch_id: str,
) -> list[dict]:
    err, rows = db.read(
        "suggestions",
        "SELECT * FROM {table} WHERE suggestion_state = ? AND batch_id = ? "
        "ORDER BY line_no_from ASC",
        params=("pending", batch_id),
    )
    if err or not rows:
        return []
    return rows


@app.post(
    "/accept_suggestion",
    summary="Accept or reject a pending suggestion",
    description=(
        "Accepts or rejects a pending suggestion from the project's local `.airefactor.db`. "
        "On accept, applies the change via `replace_file_content` and shifts line numbers "
        "of remaining pending suggestions in the same batch (matched by batch_id). "
        "Returns all remaining pending suggestions for that batch."
    ),
    response_model=AcceptSuggestionResponse,
    status_code=200,
    dependencies=[Depends(get_current_user)],
    responses={
        400: {"description": "Invalid request or suggestion not pending"},
        404: {"description": "Project, file, or suggestion not found"},
        500: {"description": "Failed to apply change or update DB"},
    },
)
def accept_suggestion(req: AcceptSuggestionRequest):
    if not STATE_FILE.is_file():
        raise HTTPException(status_code=400, detail="No active project. Call /open-project first.")

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    if state.get("project_id") != req.project_id:
        raise HTTPException(status_code=400, detail="project_id does not match active project")

    project_path = state["project_path"]
    file_path = os.path.join(project_path, req.filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    local_db_path = os.path.join(project_path, ".airefactor.db")
    if not os.path.isfile(local_db_path):
        raise HTTPException(status_code=404, detail="Project local DB not found")

    db = SQLiteDB(local_db_path)
    err, rows = db.read(
        "suggestions",
        "SELECT * FROM {table} WHERE suggestion_id = ?",
        params=(req.suggestion_id,),
    )
    if err:
        raise HTTPException(status_code=500, detail="Database read error")
    if not rows:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    suggestion = rows[0]
    if suggestion.get("suggestion_state") != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Suggestion is not pending (state={suggestion.get('suggestion_state')})",
        )

    if suggestion.get("batch_id") != req.batch_id:
        raise HTTPException(status_code=400, detail="batch_id does not match suggestion")

    adjustment = None

    if req.accept:
        lnf = int(suggestion["line_no_from"])
        lnt = int(suggestion["line_no_to"])
        replace_by = suggestion.get("replace_by") or ""

        if lnf >= 1 and lnt >= lnf:
            try:
                adjustment = replace_file_content(file_path, lnf, lnt, replace_by)
            except Exception:
                raise HTTPException(status_code=500, detail="Failed to apply file change")

            _shift_pending_line_numbers(
                db,
                accepted_to=lnt,
                extra=adjustment["extra_added_removed"],
                batch_id=req.batch_id,
                exclude_suggestion_id=req.suggestion_id,
            )
            message = "Suggestion accepted and applied"
        else:
            # The agent could not anchor the finding to a real line, so there is
            # nothing safe to rewrite. Record the acceptance without touching the
            # file rather than corrupting it.
            message = "Suggestion accepted (no file change: unknown line)"

        err, _ = db.runQuery(
            "UPDATE {table} SET suggestion_state = ? WHERE suggestion_id = ?",
            table_name="suggestions",
            params=("accepted", req.suggestion_id),
        )
        if err:
            raise HTTPException(status_code=500, detail="Failed to update suggestion state")
    else:
        err, _ = db.runQuery(
            "UPDATE {table} SET suggestion_state = ? WHERE suggestion_id = ?",
            table_name="suggestions",
            params=("rejected", req.suggestion_id),
        )
        if err:
            raise HTTPException(status_code=500, detail="Failed to update suggestion state")
        message = "Suggestion rejected"

    remaining = _get_pending_suggestions_by_batch(db, req.batch_id)

    return {
        "success": True,
        "accepted": req.accept,
        "suggestion_id": req.suggestion_id,
        "batch_id": req.batch_id,
        "adjustment": adjustment,
        "remaining_suggestions": remaining,
        "message": message,
    }


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #

def _hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except Exception:
        return False


def _create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


# Auth models
class SignupRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v

    @field_validator('full_name')
    @classmethod
    def validate_name(cls, v):
        if not v or len(v.strip()) < 1:
            raise ValueError('Full name is required')
        return v.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: Optional[bool] = False


class AuthResponse(BaseModel):
    user: dict
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        return v


class GoogleOAuthRequest(BaseModel):
    id_token: Optional[str] = None
    credential: Optional[str] = None
    code: Optional[str] = None


# ----- Simple in-memory rate limiter for auth endpoints -----
_AUTH_RATE_LIMIT = 60  # max requests
_AUTH_RATE_WINDOW_SECONDS = 300  # 5 minutes
_auth_attempts: dict = {}


def _rate_limit(request: Request, key: str):
    """Sliding-window in-memory rate limit. key = identifier (e.g. email or IP)."""
    import time
    now = time.time()
    bucket_key = f"{key}:{request.client.host if request.client else 'unknown'}"
    attempts = _auth_attempts.get(bucket_key, [])
    attempts = [t for t in attempts if now - t < _AUTH_RATE_WINDOW_SECONDS]
    if len(attempts) >= _AUTH_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many attempts. Please try again later.")
    attempts.append(now)
    _auth_attempts[bucket_key] = attempts


def _public_user(user: dict) -> dict:
    return {
        "user_id": user["user_id"],
        "full_name": user.get("full_name", ""),
        "email": user.get("email", ""),
        "is_admin": user.get("is_admin", 0),
    }


def _store_refresh_token(db: SQLiteDB, user_id: str, token: str, remember: bool = False):
    token_hash = _hash_token(token)
    days = REFRESH_TOKEN_EXPIRE_DAYS if remember else 1
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    err, _ = db.runQuery(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        table_name="refresh_tokens",
        params=(user_id, token_hash, expires_at),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to create session")
    return expires_at


def _revoke_refresh_token(db: SQLiteDB, token: str) -> bool:
    token_hash = _hash_token(token)
    err, _ = db.runQuery(
        "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?",
        table_name="refresh_tokens",
        params=(token_hash,),
    )
    return not err


def _revoke_all_user_sessions(db: SQLiteDB, user_id: str):
    db.runQuery(
        "UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?",
        table_name="refresh_tokens",
        params=(user_id,),
    )


def _set_refresh_cookie(response: Response, token: str, remember: bool = False):
    max_age = REFRESH_TOKEN_EXPIRE_DAYS * 86400 if remember else 86400
    secure = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    samesite = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    response.set_cookie(
        key="refresh_token",
        value=token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/auth",
    )


def _clear_refresh_cookie(response: Response):
    secure = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    samesite = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    response.delete_cookie(
        key="refresh_token",
        path="/auth",
        httponly=True,
        secure=secure,
        samesite=samesite,
    )


def _issue_tokens(response: Response, user: dict, remember: bool = False) -> dict:
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    access_token = _create_access_token({"sub": user["user_id"]})
    refresh_token = _create_refresh_token()
    _store_refresh_token(db, user["user_id"], refresh_token, remember=remember)
    _set_refresh_cookie(response, refresh_token, remember=remember)
    return {
        "user": _public_user(user),
        "access_token": access_token,
        "token_type": "bearer",
    }


# Auth endpoints
@app.post("/auth/signup")
def signup(req: SignupRequest, response: Response, request: Request):
    _rate_limit(request, req.email.lower())
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    email = req.email.lower().strip()
    err, rows = db.read("users", "SELECT * FROM {table} WHERE LOWER(email) = ?", params=(email,))
    if not err and rows:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = secrets.token_urlsafe(16)
    password_hash = _hash_password(req.password)
    err, _ = db.runQuery(
        "INSERT INTO {table} (user_id, full_name, email, password_hash) VALUES (?, ?, ?, ?)",
        table_name="users",
        params=(user_id, req.full_name.strip(), email, password_hash),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to create user")
    user = {
        "user_id": user_id,
        "full_name": req.full_name.strip(),
        "email": email,
        "is_admin": 0,
    }
    return _issue_tokens(response, user)


@app.post("/auth/login")
def login(req: LoginRequest, response: Response, request: Request):
    _rate_limit(request, req.email.lower())
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    email = req.email.lower().strip()
    err, rows = db.read("users", "SELECT * FROM {table} WHERE LOWER(email) = ?", params=(email,))
    if err or not rows:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = rows[0]
    if not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_active", 1):
        raise HTTPException(status_code=401, detail="Account is disabled")
    return _issue_tokens(response, user, remember=bool(req.remember_me))


@app.post("/auth/refresh")
def refresh(req: RefreshRequest, response: Response, request: Request):
    _rate_limit(request, request.client.host if request.client else "unknown")
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    token = req.refresh_token
    if not token:
        token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    token_hash = _hash_token(token)
    err, rows = db.read(
        "refresh_tokens",
        "SELECT * FROM {table} WHERE token_hash = ? AND revoked = 0",
        params=(token_hash,),
    )
    if err or not rows:
        raise HTTPException(status_code=401, detail="Invalid or revoked refresh token")
    row = rows[0]
    try:
        expires_at = datetime.fromisoformat(row["expires_at"].replace('Z', '+00:00'))
    except Exception:
        expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    # Rotate: revoke the used token, issue a new one
    _revoke_refresh_token(db, token)
    err, user_rows = db.read(
        "users",
        "SELECT * FROM {table} WHERE user_id = ? AND is_active = 1",
        params=(row["user_id"],),
    )
    if err or not user_rows:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    user = user_rows[0]
    return _issue_tokens(response, user)


@app.get("/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return {"user": _public_user(current_user)}


@app.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request):
    _rate_limit(request, req.email.lower())
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    email = req.email.lower().strip()
    err, rows = db.read("users", "SELECT * FROM {table} WHERE LOWER(email) = ?", params=(email,))
    if err or not rows:
        return {"message": "If an account with that email exists, a reset link has been sent."}
    user = rows[0]
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES)).isoformat()
    err, _ = db.runQuery(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        table_name="password_reset_tokens",
        params=(user["user_id"], token_hash, expires_at),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to process request")
    # In production, send email via configured provider. For development, log the link.
    reset_url = f"{PASSWORD_RESET_FRONTEND_URL}/reset-password?token={token}"
    print(f"[PASSWORD RESET] {email} -> {reset_url}")
    return {"message": "If an account with that email exists, a reset link has been sent."}


@app.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest, request: Request):
    _rate_limit(request, request.client.host if request.client else "unknown")
    _ensure_central_db()
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    token_hash = _hash_token(req.token)
    err, rows = db.read(
        "password_reset_tokens",
        "SELECT * FROM {table} WHERE token_hash = ? AND used = 0 ORDER BY id DESC LIMIT 1",
        params=(token_hash,),
    )
    if err or not rows:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    token_row = rows[0]
    try:
        expires_at = datetime.fromisoformat(token_row["expires_at"].replace('Z', '+00:00'))
    except Exception:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=-1)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=400, detail="Token has expired")
    password_hash = _hash_password(req.password)
    err, _ = db.runQuery(
        "UPDATE users SET password_hash = ? WHERE user_id = ?",
        table_name="users",
        params=(password_hash, token_row["user_id"]),
    )
    if err:
        raise HTTPException(status_code=500, detail="Failed to reset password")
    err, _ = db.runQuery(
        "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
        table_name="password_reset_tokens",
        params=(token_row["id"],),
    )
    # Invalidate existing sessions after a password reset
    _revoke_all_user_sessions(db, token_row["user_id"])
    return {"message": "Password reset successfully"}


@app.post("/auth/logout")
def logout(response: Response, request: Request, current_user: dict = Depends(get_current_user)):
    token = request.cookies.get("refresh_token")
    if token:
        _ensure_central_db()
        db = SQLiteDB(str(CENTRAL_DB_PATH))
        _revoke_refresh_token(db, token)
    _clear_refresh_cookie(response)
    return {"message": "Logged out successfully"}


@app.post("/auth/google")
def google_oauth(req: GoogleOAuthRequest, response: Response, request: Request):
    _rate_limit(request, request.client.host if request.client else "unknown")
    _ensure_central_db()
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    credential = req.id_token or req.credential
    if not credential:
        raise HTTPException(status_code=400, detail="Missing Google credential")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        info = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), audience=client_id
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google credentials")
    if not info or info.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="Google email not verified")
    email = info.get("email", "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email")
    name = info.get("name") or email.split("@")[0]
    provider_id = info.get("sub")
    db = SQLiteDB(str(CENTRAL_DB_PATH))
    err, rows = db.read("users", "SELECT * FROM {table} WHERE LOWER(email) = ?", params=(email,))
    if err:
        raise HTTPException(status_code=500, detail="Database error")
    if rows:
        user = rows[0]
        # Link OAuth identity if not already linked (avoid takeover: only link
        # when no conflicting provider identity exists for a different user)
        if not user.get("oauth_provider"):
            db.runQuery(
                "UPDATE users SET oauth_provider = 'google', oauth_provider_id = ? WHERE user_id = ?",
                table_name="users",
                params=(provider_id, user["user_id"]),
            )
    else:
        user_id = secrets.token_urlsafe(16)
        err, _ = db.runQuery(
            "INSERT INTO {table} (user_id, full_name, email, password_hash, oauth_provider, oauth_provider_id) "
            "VALUES (?, ?, ?, NULL, 'google', ?)",
            table_name="users",
            params=(user_id, name, email, provider_id),
        )
        if err:
            raise HTTPException(status_code=500, detail="Failed to create user")
        user = {
            "user_id": user_id,
            "full_name": name,
            "email": email,
            "is_admin": 0,
        }
    if not user.get("is_active", 1):
        raise HTTPException(status_code=401, detail="Account is disabled")
    return _issue_tokens(response, user, remember=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
