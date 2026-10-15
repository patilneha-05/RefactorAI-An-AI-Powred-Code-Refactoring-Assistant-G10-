import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderOpen, FolderPlus, RefreshCw, Trash2 } from 'lucide-react';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import { useProject } from '../context/ProjectContext';
import { useToast } from '../context/ToastContext';
import { deleteProject, listProjects } from '../services/projectService';
import { errorMessage, errorHint } from '../utils/errors';

/**
 * Projects — a simple list of the projects registered on the backend machine.
 * Each row shows its name, folder path and status (Active / Registered).
 *
 * Creating a project lives in the Launcher (Dashboard), which owns the
 * register + auto-detect-context flow; this page just lists and opens them.
 */
export default function Projects() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeProject, openExisting } = useProject();

  const [projects, setProjects] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await listProjects();
      setProjects(Array.isArray(data?.projects) ? data.projects : []);
      setError(null);
      setState('ready');
    } catch (err) {
      setError(errorMessage(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (row) => {
    if (openingId) return;
    setOpeningId(row.project_id);
    try {
      const project = await openExisting(row.project_id);
      toast.success(`Opened ${project.project_name}`, 'It is now the active project.');
      navigate('/workspace');
    } catch (err) {
      toast.error(errorMessage(err), errorHint(err) || undefined);
    } finally {
      setOpeningId(null);
    }
  };

  const remove = async (row) => {
    if (deletingId) return;
    const label = row.project_name || row.project_path;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove “${label}” from the project list? The folder on disk is not touched.`)) {
      return;
    }
    setDeletingId(row.project_id);
    try {
      await deleteProject(row.project_id);
      setProjects((prev) => prev.filter((item) => item.project_id !== row.project_id));
      toast.success('Removed from the database', 'The project folder on disk is untouched.');
    } catch (err) {
      toast.error(errorMessage(err), errorHint(err) || undefined);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-header__title">Projects</h1>
          <p className="page-header__subtitle">
            Projects registered on the backend machine. Open one to make it the active
            project across the app.
          </p>
        </div>
        <div className="row">
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={load}
            disabled={state === 'loading'}
          >
            Refresh
          </Button>
          <Link className="btn btn--primary btn--sm" to="/">
            <FolderPlus size={14} aria-hidden="true" />
            New project
          </Link>
        </div>
      </header>

      <div className="panel">
        <div className="panel__header">
          <span className="panel__title">Existing projects</span>
          {state === 'ready' ? <Badge tone="neutral">{projects.length}</Badge> : null}
        </div>

        <div className="panel__body panel__body--flush">
          {state === 'loading' ? <Loader label="Loading projects…" /> : null}

          {state === 'error' ? (
            <div className="project-list-message project-list-message--error" role="alert">
              Could not load projects: {error}
            </div>
          ) : null}

          {state === 'ready' && projects.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No projects yet"
              description="Use “New project” to register a folder on the backend machine."
              actions={
                <Link className="btn btn--primary btn--sm" to="/">
                  <FolderPlus size={14} aria-hidden="true" />
                  New project
                </Link>
              }
            />
          ) : null}

          {state === 'ready' && projects.length > 0 ? (
            <ul className="project-list">
              {projects.map((row) => {
                const isActive = activeProject?.project_id === row.project_id;
                const name = row.project_name || '(unnamed project)';
                return (
                  <li className="project-row" key={row.project_id}>
                    <span className="icon-tile icon-tile--neutral" aria-hidden="true">
                      <FolderOpen size={18} />
                    </span>

                    <div className="project-row__main">
                      <div className="project-row__heading">
                        <span className="project-row__name">{name}</span>
                        <Badge tone={isActive ? 'accent' : 'neutral'}>
                          {isActive ? 'Active' : 'Registered'}
                        </Badge>
                      </div>
                      <div className="project-row__path mono" title={row.project_path}>
                        {row.project_path}
                      </div>
                    </div>

                    <div className="project-row__actions">
                      <Button
                        size="sm"
                        variant={isActive ? 'secondary' : 'primary'}
                        loading={openingId === row.project_id}
                        disabled={Boolean(openingId) || deletingId === row.project_id}
                        onClick={() => open(row)}
                      >
                        Open
                      </Button>
                      <button
                        type="button"
                        className="project-row__remove"
                        aria-label={`Remove ${name} from the project list`}
                        title="Remove from the database (the folder is not touched)"
                        disabled={deletingId === row.project_id}
                        onClick={() => remove(row)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
