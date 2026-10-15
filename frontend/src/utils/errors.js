import { ApiError } from '../services/apiClient';

/** Extract a human-readable message from any thrown error. */
export function errorMessage(error) {
  if (!error) return 'Something went wrong.';
  if (error instanceof ApiError) return error.message;
  return error.message || 'Something went wrong.';
}

/** True when the backend reports no active project (`.state.json` missing). */
export function isNoActiveProject(error) {
  return /no active project/i.test(errorMessage(error));
}

/** True when the requested project_id differs from the backend's active one. */
export function isProjectMismatch(error) {
  return /does not match active project/i.test(errorMessage(error));
}

/**
 * Optional follow-up hint shown under an error message.
 * Avoids dumping internal paths — only gives actionable UI guidance.
 */
export function errorHint(error) {
  if (isNoActiveProject(error)) {
    return 'Open the project again from the project selector, then retry.';
  }
  if (isProjectMismatch(error)) {
    return 'The backend is tracking a different project — re-open this one from the project selector and retry.';
  }
  if (error instanceof ApiError && error.status === 404) {
    return 'The requested record no longer exists. Refresh the list and try again.';
  }
  return null;
}
