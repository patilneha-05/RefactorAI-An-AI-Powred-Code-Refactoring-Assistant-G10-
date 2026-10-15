import { AlertTriangle, Check, Info, X } from 'lucide-react';
import Modal, { ConfirmDialog } from '../common/Modal';
import Button from '../common/Button';
import SuggestionDetails from './SuggestionDetails';
import { lineRange, shortId } from '../../utils/format';

/**
 * Details + confirmation dialog for reviewing one suggestion.
 * Driven by `useSuggestionActions`: shows the details view, then swaps to a
 * confirmation step before calling /accept_suggestion.
 */
export default function SuggestionReviewDialog({ suggestion, actions, onClose }) {
  if (!suggestion) return null;

  const { confirmTarget, busyId, requestAction, cancelConfirm, confirmAction } = actions;
  const isConfirming = Boolean(
    confirmTarget && confirmTarget.suggestion.suggestion_id === suggestion.suggestion_id,
  );
  const isPending = suggestion.suggestion_state === 'pending';
  const isBusy = busyId === suggestion.suggestion_id;
  const range = lineRange(suggestion.line_no_from, suggestion.line_no_to);

  if (isConfirming) {
    const accepting = confirmTarget.accept;
    return (
      <ConfirmDialog
        open
        title={accepting ? 'Apply this change to the file?' : 'Reject this suggestion?'}
        confirmLabel={accepting ? 'Accept & apply' : 'Reject'}
        tone={accepting ? 'primary' : 'danger'}
        loading={isBusy}
        onConfirm={confirmAction}
        onCancel={cancelConfirm}
      >
        <div className="stack-sm">
          <p>
            {accepting ? (
              <>
                This replaces <strong>{range}</strong> in{' '}
                <code>{suggestion.filename}</code> on the machine running the backend and
                shifts the line numbers of the remaining pending suggestions in batch{' '}
                <code>{shortId(suggestion.batch_id, 8)}</code>.
              </>
            ) : (
              <>
                The suggestion for <code>{suggestion.filename}</code> ({range}) will be
                marked as rejected. The file is not modified.
              </>
            )}
          </p>
          <div className={`callout ${accepting ? 'callout--warning' : 'callout--info'}`}>
            <span className="callout__icon" aria-hidden="true">
              <AlertTriangle size={15} />
            </span>
            <span>
              {accepting
                ? 'The change is written directly to your source file and cannot be undone from this UI.'
                : 'You can run the agent again at any time to get fresh suggestions.'}
            </span>
          </div>
        </div>
      </ConfirmDialog>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={suggestion.suggestion_title || 'Refactoring suggestion'}
      subtitle={`${suggestion.filename || 'file'} · ${range}`}
      footer={
        isPending ? (
          <>
            <Button variant="danger" icon={X} onClick={() => requestAction(suggestion, false)} disabled={isBusy}>
              Reject
            </Button>
            <Button variant="primary" icon={Check} onClick={() => requestAction(suggestion, true)} disabled={isBusy}>
              Accept &amp; apply
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="stack">
        <SuggestionDetails suggestion={suggestion} />
        {isPending ? (
          <div className="callout callout--info">
            <span className="callout__icon" aria-hidden="true">
              <Info size={15} />
            </span>
            <span>
              Accepting applies this change to the file on the backend machine and updates
              the remaining suggestions in the same batch. Rejecting only records your
              decision — the file stays untouched.
            </span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
