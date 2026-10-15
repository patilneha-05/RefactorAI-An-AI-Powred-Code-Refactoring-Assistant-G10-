import axios from 'axios';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

/** Backend base URL — configured via VITE_API_BASE_URL (see frontend/.env). */
export const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL,
).replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 30000;

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

async function request(config) {
  try {
    const response = await axios.request({
      timeout: DEFAULT_TIMEOUT_MS,
      ...config,
      baseURL: API_BASE_URL,
    });
    return response.data;
  } catch (error) {
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
