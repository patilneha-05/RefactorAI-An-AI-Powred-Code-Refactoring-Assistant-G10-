import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, Lightbulb, Play, Trash2 } from 'lucide-react';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import SuggestionCard from '../components/suggestions/SuggestionCard';
import SuggestionReviewDialog from '../components/suggestions/SuggestionReviewDialog';
import useSuggestionActions from '../hooks/useSuggestionActions';
import { useProject } from '../context/ProjectContext';
import { useToast } from '../context/ToastContext';
import { shortId } from '../utils/format';

const FILTERS = [
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

/** Groups a suggestion list by batch_id, newest batch first. */
function groupByBatch(items) {
  const byBatch = new Map();
  for (const item of items) {
    const key = item.batch_id || 'unbatched';
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(item);
  }
  const groups = [...byBatch.entries()].map(([batchId, groupItems]) => ({
    batchId,
    filename: groupItems[0]?.filename || '',
    at: Math.max(...groupItems.map((item) => item.receivedAt || 0)),
    items: groupItems.sort(
      (a, b) => Number(a.line_no_from || 0) - Number(b.line_no_from || 0),
    ),
  }));
  return groups.sort((a, b) => b.at - a.at);
}

export default function Suggestions() {
  const { activeProject, activeSuggestions, clearResolvedSuggestions } = useProject();
  const toast = useToast();
  const [filter, setFilter] = useState('pending');
  const [selectedId, setSelectedId] = useState(null);

  const actions = useSuggestionActions({
    onResolved: () => setSelectedId(null),
  });

  const counts = useMemo(
    () => ({
      pending: activeSuggestions.filter((s) => s.suggestion_state === 'pending').length,
      accepted: activeSuggestions.filter((s) => s.suggestion_state === 'accepted').length,
      rejected: activeSuggestions.filter((s) => s.suggestion_state === 'rejected').length,
      all: activeSuggestions.length,
    }),
    [activeSuggestions],
  );

  const list = useMemo(() => {
    const filtered =
      filter === 'all'
        ? activeSuggestions
        : activeSuggestions.filter((item) => item.suggestion_state === filter);
    return [...filtered].sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
  }, [activeSuggestions, filter]);

  const groups = useMemo(() => groupByBatch(list), [list]);
  const selected = selectedId
    ? activeSuggestions.find((item) => item.suggestion_id === selectedId) || null
    : null;

  const emptyTitle =
    filter === 'all' ? 'No suggestions' : `No ${filter} suggestions`;

  const clearResolved = () => {
    const removed = clearResolvedSuggestions();
    toast.info(
      removed > 0
        ? `Cleared ${removed} resolved suggestion${removed === 1 ? '' : 's'} from this view`
        : 'Nothing to clear',
      removed > 0 ? 'The backend records are not affected.' : undefined,
    );
  };

  if (!activeProject) {
    return (
      <div className="page">
        <EmptyState
          icon={Lightbulb}
          title="No active project"
          description="Suggestions are stored per project. Open a project first, then run a refactor in the workspace to collect suggestions."
          actions={
            <Link className="btn btn--primary" to="/projects">
              Open a project
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Suggestions</h1>
          <p className="page-header__subtitle">
            Review AI suggestions for <strong>{activeProject.project_name}</strong>. Accepting
            applies the change to the source file on the backend machine and updates the
            remaining suggestions of the same batch.
          </p>
        </div>
        <div className="row">
          {counts.accepted + counts.rejected > 0 ? (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={clearResolved}>
              Clear resolved
            </Button>
          ) : null}
          <Link className="btn btn--primary btn--sm" to="/workspace">
            <Play size={14} aria-hidden="true" />
            New refactor run
          </Link>
        </div>
      </header>

      <div className="suggestions-toolbar">
        <div className="tabs" role="tablist" aria-label="Filter suggestions">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="tab__count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <span className="text-muted" style={{ fontSize: 'var(--fs-sm)' }}>
          {list.length} shown
        </span>
      </div>

      {list.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Lightbulb}
            title={emptyTitle}
            description={
              filter === 'pending'
                ? 'Run a refactoring agent on a source file — its suggestions will land here for review.'
                : 'Nothing in this category yet for the active project.'
            }
            actions={
              <Link className="btn btn--secondary btn--sm" to="/workspace">
                Go to workspace
              </Link>
            }
          />
        </div>
      ) : (
        <div className="suggestions-list">
          {groups.map((group) => (
            <Fragment key={group.batchId}>
              <div className="batch-divider">
                <span className="batch-divider__label">
                  <GitBranch size={13} aria-hidden="true" />
                  Batch {shortId(group.batchId, 8)} · {group.filename}
                </span>
                <span className="batch-divider__line" />
                <Badge tone="neutral">{group.items.length}</Badge>
              </div>
              {group.items.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.suggestion_id}
                  suggestion={suggestion}
                  selected={selectedId === suggestion.suggestion_id}
                  onInspect={() => setSelectedId(suggestion.suggestion_id)}
                  onAccept={(item) => actions.requestAction(item, true)}
                  onReject={(item) => actions.requestAction(item, false)}
                  busy={actions.busyId === suggestion.suggestion_id}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}

      <SuggestionReviewDialog
        suggestion={selected}
        actions={actions}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
