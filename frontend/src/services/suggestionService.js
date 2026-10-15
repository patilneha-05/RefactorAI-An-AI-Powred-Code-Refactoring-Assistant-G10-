import { apiClient } from './apiClient';

/**
 * POST /accept_suggestion — accept or reject a pending suggestion.
 *
 * Request: { project_id, filename, suggestion_id, batch_id, accept }
 * Response: {
 *   success, accepted, suggestion_id, batch_id,
 *   adjustment: { effective_from, lines_added, lines_removed, extra_added_removed } | null,
 *   remaining_suggestions: [...],   // still-pending rows of the same batch
 *   message
 * }
 *
 * On accept the backend rewrites the source file and shifts line numbers of
 * the remaining pending suggestions in the same batch.
 */
export function resolveSuggestion({ projectId, filename, suggestionId, batchId, accept }) {
  return apiClient.post('/accept_suggestion', {
    project_id: projectId,
    filename,
    suggestion_id: suggestionId,
    batch_id: batchId,
    accept: Boolean(accept),
  });
}
