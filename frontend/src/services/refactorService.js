import { apiClient, ApiError } from './apiClient';
import { DEFAULT_USER_MESSAGE } from '../config/agents';

/** The agent run performs a full LLM call — allow up to 5.5 minutes. */
const REFACTOR_TIMEOUT_MS = 330000;

/**
 * POST /refactor — { project_id, filename, agent_id, user_message }
 *
 * Response (HTTP 200 either way):
 *  - success: { success: true, agent, suggestions: [...], model, error? }
 *  - failure: { success: false, agent?, model?, error: { type, message } }
 *    (or { success: false, error: { "Internal Server Error": "…" } })
 *
 * A `success: false` body is thrown as ApiError so callers can treat every
 * failure the same way as HTTP errors.
 */
export async function refactor({ projectId, filename, agentId, userMessage }) {
  const data = await apiClient.post(
    '/refactor',
    {
      project_id: projectId,
      filename,
      agent_id: agentId,
      user_message: userMessage?.trim() || DEFAULT_USER_MESSAGE,
    },
    { timeout: REFACTOR_TIMEOUT_MS },
  );

  if (!data?.success) {
    const error = data?.error || {};
    const message =
      error.message || error['Internal Server Error'] || 'The refactoring agent failed.';
    const type =
      error.type || (error['Internal Server Error'] ? 'Internal Server Error' : 'AgentError');
    throw new ApiError(`${type}: ${message}`, {
      status: 200,
      code: 'REFACTOR_FAILED',
      details: data ?? null,
    });
  }

  return data;
}
