import { useCallback, useState } from 'react';
import { useProject } from '../context/ProjectContext';
import { useToast } from '../context/ToastContext';
import { errorMessage, errorHint } from '../utils/errors';

/**
 * Shared accept/reject workflow for suggestions:
 *  1. requestAction(suggestion, accept) → asks for confirmation
 *  2. confirmAction()                   → calls /accept_suggestion
 *  3. the parent renders ConfirmDialog based on `confirmTarget`
 *
 * Duplicate submissions are blocked via `busyId`; results are surfaced as
 * toasts (including the backend's adjustment info after an accept).
 */
export default function useSuggestionActions({ onResolved } = {}) {
  const { resolveSuggestion } = useProject();
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null); // { suggestion, accept }

  const requestAction = useCallback((suggestion, accept) => {
    setConfirmTarget({ suggestion, accept });
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirmTarget(null);
  }, []);

  const confirmAction = useCallback(async () => {
    if (!confirmTarget || busyId) return null;
    const { suggestion, accept } = confirmTarget;
    setBusyId(suggestion.suggestion_id);
    try {
      const response = await resolveSuggestion({ suggestion, accept });
      setConfirmTarget(null);
      if (accept) {
        const adjustment = response.adjustment;
        const detail = adjustment
          ? `${adjustment.lines_added} line(s) added, ${adjustment.lines_removed} removed in ${suggestion.filename}`
          : `Applied to ${suggestion.filename}`;
        toast.success(response.message || 'Suggestion accepted and applied', detail);
      } else {
        toast.success(
          response.message || 'Suggestion rejected',
          `Recorded for ${suggestion.filename}`,
        );
      }
      onResolved?.(response, suggestion);
      return response;
    } catch (error) {
      // A 404 means the suggestion is no longer in the project DB (the context
      // already dropped the stale card). Treat it as a no-op, not a failure.
      if (error?.status === 404) {
        setConfirmTarget(null);
        toast.success(
          'Suggestion already resolved',
          'It is no longer available and was removed from the list.',
        );
        return null;
      }
      toast.error(errorMessage(error), errorHint(error) || undefined);
      return null;
    } finally {
      setBusyId(null);
    }
  }, [confirmTarget, busyId, resolveSuggestion, toast, onResolved]);

  return { busyId, confirmTarget, requestAction, cancelConfirm, confirmAction };
}
