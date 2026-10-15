import { Check, Eye, X } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { lineRange, shortId, suggestionStatus } from '../../utils/format';

/** Map an analysis-agent severity to a badge tone. */
function severityTone(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'critical' || value === 'high') return 'danger';
  if (value === 'medium' || value === 'moderate') return 'warning';
  if (value === 'low' || value === 'info') return 'info';
  return 'neutral';
}

/**
 * Card summarizing one suggestion returned by /refactor (or adjusted by
 * /accept_suggestion). Pending suggestions get Accept/Reject actions.
 */
export default function SuggestionCard({
  suggestion,
  selected = false,
  onInspect,
  onAccept,
  onReject,
  busy = false,
  showFilename = true,
}) {
  const status = suggestionStatus(suggestion.suggestion_state);
  const isPending = suggestion.suggestion_state === 'pending';

  return (
    <article className={`suggestion-card${selected ? ' suggestion-card--selected' : ''}`}>
      <div className="suggestion-card__top">
        <div className="suggestion-card__title">
          {suggestion.suggestion_title || 'Refactoring suggestion'}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="suggestion-card__meta">
        {showFilename && suggestion.filename ? (
          <Badge tone="neutral" mono title={suggestion.filename}>
            {suggestion.filename}
          </Badge>
        ) : null}
        <Badge tone="info" mono>
          {lineRange(suggestion.line_no_from, suggestion.line_no_to)}
        </Badge>
        {suggestion.severity ? (
          <Badge tone={severityTone(suggestion.severity)} mono title={`Severity: ${suggestion.severity}`}>
            {String(suggestion.severity).toUpperCase()}
          </Badge>
        ) : null}
        {suggestion.batch_id ? (
          <Badge tone="neutral" mono title={`Batch ${suggestion.batch_id}`}>
            {shortId(suggestion.batch_id, 6)}
          </Badge>
        ) : null}
      </div>

      <p className="suggestion-card__desc">
        {suggestion.suggestion_description || 'No description provided by the agent.'}
      </p>

      <div className="suggestion-card__actions">
        {isPending ? (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              loading={busy}
              onClick={() => onAccept(suggestion)}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={X}
              loading={busy}
              onClick={() => onReject(suggestion)}
            >
              Reject
            </Button>
          </>
        ) : null}
        {onInspect ? (
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => onInspect(suggestion)}>
            Details
          </Button>
        ) : null}
      </div>
    </article>
  );
}
