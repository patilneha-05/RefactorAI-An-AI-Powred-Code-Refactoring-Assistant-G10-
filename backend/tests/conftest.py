"""
Shared pytest fixtures for the RefactorAI backend auth tests.

The suite runs against an isolated temporary central database so it never
touches the real `backend/data/.airefactor_central.db`. Import of `main` is
performed here after setting a deterministic JWT secret.
"""

import os
import sys

import pytest

# Make `backend/` importable regardless of where pytest is invoked from.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# Deterministic secret for token assertions — must be set before importing main.
os.environ.setdefault("JWT_SECRET", "unit-test-secret-0123456789abcdef0123456789abcdef")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
os.environ.setdefault("PASSWORD_RESET_EXPIRE_MINUTES", "30")

from fastapi.testclient import TestClient  # noqa: E402

import main as app_module  # noqa: E402


@pytest.fixture()
def app():
    return app_module


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """
    TestClient wired to a fresh, empty central database.

    Also redirects the active-project pointer to a temp file and clears the
    in-memory auth rate limiter, so tests never touch real state or trip the
    per-identifier throttle.
    """
    db_path = tmp_path / "central_test.db"
    monkeypatch.setattr(app_module, "CENTRAL_DB_PATH", db_path)
    monkeypatch.setattr(app_module, "STATE_FILE", tmp_path / ".state.json")
    app_module._auth_attempts.clear()
    app_module._ensure_central_db()
    with TestClient(app_module.app) as test_client:
        yield test_client
    app_module._auth_attempts.clear()


@pytest.fixture()
def auth_headers(client):
    """Factory: register a unique user and return its Authorization headers."""

    def _make(password="password123", email=None, full_name="Test User"):
        email = email or f"user_{os.urandom(6).hex()}@example.com"
        response = client.post(
            "/auth/signup",
            json={"full_name": full_name, "email": email, "password": password},
        )
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}, response.json()["user"], email, password

    return _make


@pytest.fixture()
def sample_project(client, auth_headers, tmp_path):
    """
    Register a throwaway project containing a single source file and return
    everything the suggestion tests need.

    Returns a dict with the auth headers, project_id, folder path, filename
    and the original file text.
    """
    headers, *_ = auth_headers()
    folder = tmp_path / "project"
    folder.mkdir()
    filename = "game.py"
    original = "line1\nline2\nline3\nline4\nline5\n"
    (folder / filename).write_text(original)

    response = client.post(
        "/open_project",
        json={
            "is_new": True,
            "project_name": "project",
            "folder_path": str(folder),
            "project_context": {},
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text

    return {
        "headers": headers,
        "project_id": response.json()["project_id"],
        "folder": folder,
        "filename": filename,
        "original": original,
    }

