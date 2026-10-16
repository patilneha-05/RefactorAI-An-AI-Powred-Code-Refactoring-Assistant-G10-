import axios from 'axios';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

/** Backend base URL — configured via VITE_API_BASE_URL (see frontend/.env). */
export const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL,
).replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Access-token handling.
//
// The short-lived access token lives in memory (never localStorage). The
// long-lived refresh token is an HttpOnly cookie scoped to /auth, so the
// browser sends it automatically when `withCredentials` is set. On a 401 the
// client attempts exactly one silent refresh and retries the original request.
// ---------------------------------------------------------------------------

let accessToken = null;
const sessionExpiredListeners = new Set();

/** Set the in-memory access token (call with null to clear). */
export function setAccessToken(token) {
  accessToken = token || null;
}

/** Current in-memory access token, if any. */
export function getAccessToken() {
  return accessToken;
}

/**
 * Subscribe to session-expiry notifications (fired when a silent refresh
 * fails). Returns an unsubscribe function.
 */
export function onSessionExpired(listener) {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function emitSessionExpired() {
  sessionExpiredListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* listener errors must not break request flow */
    }
  });
}

/** Endpoints whose 401 must NOT trigger a silent refresh (avoid loops). */
const NO_REFRESH_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/refresh',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/google',
]);

/** Endpoints that must not carry a stale Authorization header. */
const NO_AUTH_HEADER_PATHS = new Set([
  '/auth/login',
  '/auth/signup',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/google',
]);

/** Normalized error for every API failure. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Flatten FastAPI error payloads into one readable message:
 *  - {"detail": "…"}                       → "…"
 *  - {"detail": [{loc, msg}, …]}           → "field: msg; …" (422 validation)
 *  - {"detail": {"Key": "message"}}        → "Key: message" (object details)
 */
function flattenDetail(detail) {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === 'string') return item;
      const loc = Array.isArray(item?.loc)
        ? item.loc.filter((part) => part !== 'body').join(' → ')
        : '';
      const msg = item?.msg ?? 'invalid value';
      return loc ? `${loc}: ${msg}` : msg;
    });
    const joined = parts.filter(Boolean).join('; ');
    return joined || null;
  }
  if (typeof detail === 'object') {
    const parts = Object.entries(detail).map(([key, value]) =>
      typeof value === 'string' && value ? `${key}: ${value}` : key,
    );
    const joined = parts.filter(Boolean).join('; ');
    return joined || null;
  }
  return null;
}

function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (error?.response) {
    const { status, data } = error.response;
    const message =
      flattenDetail(data?.detail ?? data) || `Request failed with status ${status}.`;
    return new ApiError(message, { status, code: error.code || '', details: data ?? null });
  }

  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return new ApiError(
      'The request timed out. The backend may still be processing — wait a moment and retry.',
      { code: 'TIMEOUT' },
    );
  }

  if (error?.request) {
    return new ApiError(
      `Cannot reach the backend at ${API_BASE_URL}. Check that it is running and reachable.`,
      { code: 'NETWORK' },
    );
  }

  return new ApiError(error?.message || 'Unexpected request error.', { code: 'UNKNOWN' });
}

/**
 * Attempt one silent refresh using the HttpOnly refresh cookie.
 * Resolves to true when a new access token was obtained.
 */
let refreshPromise = null;
async function trySilentRefresh() {
  if (!refreshPromise) {
    refreshPromise = axios
      .request({
        method: 'POST',
        url: '/auth/refresh',
        baseURL: API_BASE_URL,
        data: {},
        withCredentials: true,
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      })
      .then((response) => {
        const token = response?.data?.access_token;
        if (token) {
          setAccessToken(token);
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(config) {
  const isAuthPath = NO_REFRESH_PATHS.has(config.url);
  const cfg = {
    timeout: DEFAULT_TIMEOUT_MS,
    withCredentials: true, // send the HttpOnly refresh cookie where relevant
    ...config,
    baseURL: API_BASE_URL,
  };
  const headers = { ...(cfg.headers || {}) };
  if (accessToken && !NO_AUTH_HEADER_PATHS.has(config.url)) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  cfg.headers = headers;

  try {
    const response = await axios.request(cfg);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const canRetry = status === 401 && !isAuthPath && !cfg._retried;
    if (canRetry) {
      const refreshed = await trySilentRefresh();
      if (refreshed) {
        return request({ ...cfg, _retried: true });
      }
      // Refresh failed — the session is genuinely over.
      setAccessToken(null);
      emitSessionExpired();
    }
    throw normalizeError(error);
  }
}

/**
 * Thin Axios wrapper used by every service module.
 * All failures are thrown as `ApiError` with a user-readable message.
 */
export const apiClient = {
  get: (url, config = {}) => request({ method: 'GET', url, ...config }),
  post: (url, data, config = {}) => request({ method: 'POST', url, data, ...config }),
};
