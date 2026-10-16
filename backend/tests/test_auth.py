"""
End-to-end tests for the RefactorAI authentication system.

Covers signup, login, protected endpoints, token expiry, refresh rotation and
reuse detection, logout revocation, password reset (including token expiry and
single-use enforcement), session invalidation, and Google OAuth validation.
"""

from datetime import timedelta

import pytest


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _extract_reset_token(capsys):
    """Pull the single-use reset token out of the dev-mode printed reset URL."""
    out = capsys.readouterr().out
    for line in out.splitlines():
        if "[PASSWORD RESET]" in line and "token=" in line:
            return line.split("token=", 1)[1].strip()
    raise AssertionError("No password reset token was printed by the backend.")


def _signup(client, email="casey@example.com", password="password123", name="Casey Dev"):
    return client.post(
        "/auth/signup",
        json={"full_name": name, "email": email, "password": password},
    )


# --------------------------------------------------------------------------- #
# 1-3. Signup
# --------------------------------------------------------------------------- #

def test_signup_success(client):
    response = _signup(client)
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "casey@example.com"
    assert body["user"]["is_admin"] == 0
    assert "password" not in body["user"]
    assert "password_hash" not in body["user"]
    assert body["access_token"]


def test_signup_duplicate_email_rejected(client):
    assert _signup(client).status_code == 200
    duplicate = _signup(client, email="CASEY@example.com")  # case-insensitive
    assert duplicate.status_code == 400
    assert "already registered" in duplicate.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"full_name": "", "email": "a@b.com", "password": "password123"},
        {"full_name": "A", "email": "not-an-email", "password": "password123"},
        {"full_name": "A", "email": "a@b.com", "password": "short"},
    ],
)
def test_signup_invalid_data(client, payload):
    response = client.post("/auth/signup", json=payload)
    assert response.status_code == 422  # pydantic validation


# --------------------------------------------------------------------------- #
# 4-5. Login
# --------------------------------------------------------------------------- #

def test_login_success(client):
    _signup(client)
    response = client.post(
        "/auth/login", json={"email": "casey@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "casey@example.com"


def test_login_wrong_password_is_generic(client):
    _signup(client)
    response = client.post(
        "/auth/login", json={"email": "casey@example.com", "password": "wrongpass1"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_unknown_user_is_generic(client):
    response = client.post(
        "/auth/login", json={"email": "ghost@example.com", "password": "password123"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


# --------------------------------------------------------------------------- #
# 6-8. Protected endpoints & token validity
# --------------------------------------------------------------------------- #

def test_protected_endpoint_without_token(client):
    assert client.post("/list_projects", json={}).status_code == 401


def test_protected_endpoint_with_valid_token(client, auth_headers):
    headers, *_ = auth_headers()
    assert client.post("/list_projects", json={}, headers=headers).status_code == 200


def test_me_returns_current_user(client, auth_headers):
    headers, user, email, _ = auth_headers()
    response = client.get("/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["user"]["email"] == email
    assert response.json()["user"]["user_id"] == user["user_id"]


def test_expired_access_token_rejected(client, auth_headers, app):
    headers, user, *_ = auth_headers()
    expired = app._create_access_token(
        {"sub": user["user_id"]}, expires_delta=timedelta(seconds=-30)
    )
    response = client.post(
        "/list_projects", json={}, headers={"Authorization": f"Bearer {expired}"}
    )
    assert response.status_code == 401


def test_garbage_token_rejected(client):
    response = client.post(
        "/list_projects", json={}, headers={"Authorization": "Bearer not.a.token"}
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------- #
# 9. Refresh rotation + reuse detection
# --------------------------------------------------------------------------- #

def test_refresh_rotates_and_detects_reuse(client):
    _signup(client)
    login = client.post(
        "/auth/login",
        json={"email": "casey@example.com", "password": "password123", "remember_me": True},
    )
    old_refresh = client.cookies.get("refresh_token")
    assert old_refresh
    assert login.status_code == 200

    # First refresh uses the cookie and rotates it.
    first = client.post("/auth/refresh", json={})
    assert first.status_code == 200
    new_refresh = client.cookies.get("refresh_token")
    assert new_refresh and new_refresh != old_refresh

    # Replaying the now-revoked old token must be rejected.
    reuse = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert reuse.status_code == 401


def test_refresh_without_any_token(client):
    # Clear the jar so no refresh cookie is sent.
    client.cookies.clear()
    assert client.post("/auth/refresh", json={}).status_code == 401


# --------------------------------------------------------------------------- #
# 10. Logout
# --------------------------------------------------------------------------- #

def test_logout_revokes_refresh_session(client):
    _signup(client)
    login = client.post(
        "/auth/login", json={"email": "casey@example.com", "password": "password123"}
    )
    refresh_token = client.cookies.get("refresh_token")
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    assert client.post("/auth/logout", json={}, headers=headers).status_code == 200

    # The revoked refresh token can no longer mint a session.
    reuse = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert reuse.status_code == 401


# --------------------------------------------------------------------------- #
# 11-15. Password reset
# --------------------------------------------------------------------------- #

def test_forgot_password_no_account_enumeration(client, capsys):
    existing = client.post(
        "/auth/forgot-password", json={"email": "casey@example.com"}
    )
    missing = client.post(
        "/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    assert existing.status_code == 200
    assert missing.status_code == 200
    # Identical, generic message whether or not the account exists.
    assert existing.json()["message"] == missing.json()["message"]


def test_reset_password_full_flow(client, capsys):
    _signup(client, email="casey@example.com", password="oldpassword1")

    client.post("/auth/forgot-password", json={"email": "casey@example.com"})
    token = _extract_reset_token(capsys)

    reset = client.post(
        "/auth/reset-password", json={"token": token, "password": "brandnewpass1"}
    )
    assert reset.status_code == 200

    # New password works, old one does not.
    assert client.post(
        "/auth/login", json={"email": "casey@example.com", "password": "brandnewpass1"}
    ).status_code == 200
    assert client.post(
        "/auth/login", json={"email": "casey@example.com", "password": "oldpassword1"}
    ).status_code == 401


def test_reset_token_is_single_use(client, capsys):
    _signup(client)
    client.post("/auth/forgot-password", json={"email": "casey@example.com"})
    token = _extract_reset_token(capsys)

    assert client.post(
        "/auth/reset-password", json={"token": token, "password": "brandnewpass1"}
    ).status_code == 200
    # Reusing the same token must fail.
    reuse = client.post(
        "/auth/reset-password", json={"token": token, "password": "anotherpass9"}
    )
    assert reuse.status_code == 400


def test_reset_password_invalid_token(client):
    response = client.post(
        "/auth/reset-password", json={"token": "totally-bogus", "password": "password123"}
    )
    assert response.status_code == 400


def test_reset_password_expired_token(client, capsys, monkeypatch, app):
    _signup(client)
    # Create the reset token with an already-elapsed lifetime.
    monkeypatch.setattr(app, "PASSWORD_RESET_EXPIRE_MINUTES", -5)
    client.post("/auth/forgot-password", json={"email": "casey@example.com"})
    token = _extract_reset_token(capsys)

    response = client.post(
        "/auth/reset-password", json={"token": token, "password": "brandnewpass1"}
    )
    # Either rejected outright or treated as invalid — both are 400.
    assert response.status_code == 400


def test_reset_password_invalidates_existing_sessions(client, capsys, app):
    _signup(client)
    login = client.post(
        "/auth/login",
        json={"email": "casey@example.com", "password": "password123", "remember_me": True},
    )
    refresh_token = client.cookies.get("refresh_token")
    assert refresh_token

    client.post("/auth/forgot-password", json={"email": "casey@example.com"})
    token = _extract_reset_token(capsys)
    assert client.post(
        "/auth/reset-password", json={"token": token, "password": "brandnewpass1"}
    ).status_code == 200

    # Pre-reset refresh session must be revoked.
    reuse = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert reuse.status_code == 401


# --------------------------------------------------------------------------- #
# 16-17. Google OAuth
# --------------------------------------------------------------------------- #

def test_google_oauth_not_configured(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    response = client.post("/auth/google", json={"id_token": "anything"})
    assert response.status_code == 503


def test_google_oauth_invalid_credential(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "dummy.apps.googleusercontent.com")

    def _raise(*args, **kwargs):
        raise ValueError("invalid signature")

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", _raise)
    response = client.post("/auth/google", json={"id_token": "bogus.token.here"})
    assert response.status_code == 401


def test_google_oauth_missing_credential(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "dummy.apps.googleusercontent.com")
    response = client.post("/auth/google", json={})
    assert response.status_code == 400


def test_google_oauth_success_creates_and_links_account(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "dummy.apps.googleusercontent.com")

    def _verify(token, request, audience=None):
        return {
            "email_verified": True,
            "email": "guser@example.com",
            "name": "G User",
            "sub": "google-sub-123",
        }

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", _verify)
    response = client.post("/auth/google", json={"id_token": "valid.jwt.token"})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "guser@example.com"
    assert body["access_token"]

    # The issued token authenticates protected endpoints.
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert client.get("/auth/me", headers=headers).status_code == 200

    # Signing in again with the same Google account reuses the same user.
    second = client.post("/auth/google", json={"id_token": "valid.jwt.token"})
    assert second.status_code == 200
    assert second.json()["user"]["user_id"] == body["user"]["user_id"]


def test_google_oauth_unverified_email_rejected(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "dummy.apps.googleusercontent.com")

    def _verify(token, request, audience=None):
        return {"email_verified": False, "email": "x@example.com", "sub": "abc"}

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", _verify)
    assert client.post("/auth/google", json={"id_token": "t"}).status_code == 401


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #

def test_rate_limit_throttles_auth_attempts(client):
    last_status = None
    for _ in range(61):
        last_status = client.post(
            "/auth/forgot-password", json={"email": "throttle@example.com"}
        ).status_code
    assert last_status == 429


# --------------------------------------------------------------------------- #
# Existing functionality still works (regression)
# --------------------------------------------------------------------------- #

def test_openapi_schema_still_served(client):
    # Health-check route used by the frontend must remain unauthenticated.
    assert client.get("/openapi.json").status_code == 200


def test_health_endpoint_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_dev_flush_endpoints_stay_open(client):
    assert client.post("/_dev_flush_data").status_code == 200


def test_projects_flow_requires_and_accepts_auth(client, auth_headers):
    headers, *_ = auth_headers()
    # list_projects is protected but works with a valid token.
    response = client.post("/list_projects", json={}, headers=headers)
    assert response.status_code == 200
    assert "projects" in response.json()
