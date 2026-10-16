import { apiClient, setAccessToken, getAccessToken } from './apiClient';

/**
 * Authentication service — thin wrappers over the backend /auth routes.
 *
 * Backend routes (see backend/main.py):
 *   POST /auth/signup         { full_name, email, password } -> { user, access_token, token_type }
 *   POST /auth/login          { email, password, remember_me } -> { user, access_token, token_type }
 *   POST /auth/refresh        {} (HttpOnly cookie) -> { user, access_token, token_type }
 *   GET  /auth/me             (Bearer) -> { user }
 *   POST /auth/logout         (Bearer) -> { message }
 *   POST /auth/forgot-password { email } -> { message }
 *   POST /auth/reset-password  { token, password } -> { message }
 *   POST /auth/google          { id_token } -> { user, access_token, token_type }
 *
 * The access token is kept in memory (apiClient); the refresh token lives in
 * an HttpOnly cookie scoped to /auth.
 */

function adoptSession(payload) {
  if (payload?.access_token) setAccessToken(payload.access_token);
  return payload;
}

export async function signup({ fullName, email, password }) {
  const data = await apiClient.post('/auth/signup', {
    full_name: fullName,
    email,
    password,
  });
  return adoptSession(data);
}

export async function login({ email, password, rememberMe = false }) {
  const data = await apiClient.post('/auth/login', {
    email,
    password,
    remember_me: rememberMe,
  });
  return adoptSession(data);
}

export async function googleAuth({ idToken }) {
  const data = await apiClient.post('/auth/google', { id_token: idToken });
  return adoptSession(data);
}

/** Restore the current session. Returns { user } or throws on failure. */
export async function fetchCurrentUser() {
  return apiClient.get('/auth/me');
}

/** Force one silent refresh cycle. Returns { user, access_token } or throws. */
export async function refreshSession() {
  const data = await apiClient.post('/auth/refresh', {});
  return adoptSession(data);
}

export async function logout() {
  try {
    await apiClient.post('/auth/logout', {});
  } finally {
    // Always clear the in-memory token, even if the network call failed.
    setAccessToken(null);
  }
}

export function forgotPassword({ email }) {
  return apiClient.post('/auth/forgot-password', { email });
}

export function resetPassword({ token, password }) {
  return apiClient.post('/auth/reset-password', { token, password });
}

export { getAccessToken };
