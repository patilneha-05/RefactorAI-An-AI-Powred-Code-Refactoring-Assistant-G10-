import { AlertTriangle, FileCode, Info } from 'lucide-react';
import Badge from '../common/Badge';
import { lineRange, shortId, suggestionStatus } from '../../utils/format';

/** Full breakdown of a single suggestion, used inside the review dialog. */
export default function SuggestionDetails({ suggestion }) {
  const status = suggestionStatus(suggestion.suggestion_state);
  const range = lineRange(suggestion.line_no_from, suggestion.line_no_to);
  const hasReplacement =
    suggestion.replace_by !== undefined && suggestion.replace_by !== null;

  return (
    <div className="stack">
      <div className="detail-grid">
        <div>
          <div className="detail-item__label">File</div>
          <div className="detail-item__value">{suggestion.filename || '—'}</div>
        </div>
        <div>
          <div className="detail-item__label">Lines</div>
          <div className="detail-item__value">{range}</div>
        </div>
        <div>
          <div className="detail-item__label">State</div>
          <div className="detail-item__value">
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>
        <div>
          <div className="detail-item__label">Agent</div>
          <div className="detail-item__value">
            {suggestion.agent || suggestion.agent_id || '—'}
          </div>
        </div>
        <div>
          <div className="detail-item__label">Batch</div>
          <div className="detail-item__value" title={suggestion.batch_id}>
            {shortId(suggestion.batch_id, 12)}
          </div>
        </div>
        <div>
          <div className="detail-item__label">Suggestion ID</div>
          <div className="detail-item__value" title={suggestion.suggestion_id}>
            {shortId(suggestion.suggestion_id, 14)}
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section__title">
          <Info size={15} aria-hidden="true" />
          Description
        </div>
        <p className="suggestion-card__desc suggestion-card__desc--full">
          {suggestion.suggestion_description || 'No description provided by the agent.'}
        </p>
      </div>

      {suggestion.old_lines ? (
        <div className="detail-section">
          <div className="detail-section__title">
            <FileCode size={15} aria-hidden="true" />
            Current code ({range})
          </div>
          <pre className="code-block code-block--del">{suggestion.old_lines}</pre>
        </div>
      ) : null}

      {hasReplacement ? (
        <div className="detail-section">
          <div className="detail-section__title">
            <AlertTriangle size={15} aria-hidden="true" />
            Proposed change
          </div>
          {String(suggestion.replace_by).length > 0 ? (
            <pre className="code-block code-block--add">{suggestion.replace_by}</pre>
          ) : (
            <div className="callout callout--warning">
              <span>
                Accepting this suggestion <strong>removes lines {range}</strong> without a
                replacement.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
