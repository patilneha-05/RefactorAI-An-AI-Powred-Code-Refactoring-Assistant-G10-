import { FolderOpen } from 'lucide-react';
import Badge from '../common/Badge';
import { shortId } from '../../utils/format';

/**
 * Summary card for an opened/registered project.
 * `project` comes straight from an /open_project response (or local history).
 */
export default function ProjectCard({ project, active = false, treeSummary = null, actions = null }) {
  return (
    <div className="card">
      <div className="card__body stack-sm">
        <div className="row-between">
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <span className="icon-tile" aria-hidden="true">
              <FolderOpen size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, color: 'var(--text)' }}>{project.project_name}</div>
              <div className="text-muted mono" style={{ overflowWrap: 'anywhere' }}>
                {project.project_path}
              </div>
            </div>
          </div>
          {active ? <Badge tone="accent">Active</Badge> : null}
        </div>

        <div className="kv-list">
          <div className="kv-list__row">
            <span className="kv-list__key">Project ID</span>
            <span className="kv-list__value" title={project.project_id}>
              {shortId(project.project_id, 14)}
            </span>
          </div>
          {treeSummary ? (
            <div className="kv-list__row">
              <span className="kv-list__key">Contents</span>
              <span className="kv-list__value">
                {treeSummary.files} files · {treeSummary.folders} folders
              </span>
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="card__footer">{actions}</div> : null}
    </div>
  );
}
