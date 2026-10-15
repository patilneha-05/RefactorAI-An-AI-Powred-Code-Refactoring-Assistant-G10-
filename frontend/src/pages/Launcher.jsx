import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../context/ProjectContext';
import { useApiStatus } from '../context/ApiStatusContext';
import { useToast } from '../context/ToastContext';
import { deleteProject, detectProjectContext, listProjects } from '../services/projectService';
import Topbar from '../components/layout/Topbar';
import ProjectContextDialog from '../components/common/ProjectContextDialog';
import { errorMessage, errorHint } from '../utils/errors';

const EMPTY_FORM = { name: '', path: '' };

/** "7/31/2026, 1:38:22 PM" — matching the design's LAST OPENED column. */
function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

/**
 * Launcher / Dashboard — the supplied launcher design, rendered verbatim and
 * wired to the real backend:
 *   START NEW PROJECT → POST /open_project { is_new: true }
 *   recent table      → POST /list_projects  (additive)
 *   DELETE            → POST /delete_project (additive)
 *   footer status     → GET  /openapi.json via ApiStatusContext
 *
 * CLONE REPOSITORY is present in the design, but the backend exposes no clone
 * endpoint, so it surfaces an honest "not available" notice instead of faking a
 * clone.
 */
export default function Launcher() {
  const navigate = useNavigate();
  const toast = useToast();
  const { registerNew, openExisting } = useProject();
  const { status, schema } = useApiStatus();

  const [projects, setProjects] = useState([]);
  const [listState, setListState] = useState('loading'); // loading | ready | error
  const [listError, setListError] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // null | 'project' | 'clone'
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Context builder — shown after the create form is submitted, before the
  // project is actually registered.
  const [contextOpen, setContextOpen] = useState(false);
  const [contextError, setContextError] = useState(null);
  const [contextBase, setContextBase] = useState({});
  const [contextAutoDetected, setContextAutoDetected] = useState(false);
  const [draft, setDraft] = useState(EMPTY_FORM);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(Array.isArray(data?.projects) ? data.projects : []);
      setListError(null);
      setListState('ready');
    } catch (error) {
      setListError(errorMessage(error));
      setListState('error');
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!modalMode) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalMode, closeModal]);

  const openModal = (mode) => {
    setModalMode(mode);
    setForm(EMPTY_FORM);
    setFormError(null);
    setNotice(null);
  };

  const scrollToProjects = () => {
    document
      .getElementById('recent-projects')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openRecent = async (row) => {
    if (openingId) return;
    setOpeningId(row.project_id);
    try {
      const project = await openExisting(row.project_id);
      toast.success(`Opened ${project.project_name}`, 'It is now the active project.');
      navigate('/workspace');
    } catch (error) {
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setOpeningId(null);
    }
  };

  const removeProject = async (row) => {
    if (deletingId) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm('Remove this project from the displayed list?')) return;
    setDeletingId(row.project_id);
    try {
      await deleteProject(row.project_id);
      setProjects((prev) => prev.filter((item) => item.project_id !== row.project_id));
      toast.success('Removed from the database', 'The project folder on disk is untouched.');
    } catch (error) {
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setDeletingId(null);
    }
  };

  const submit = async (event) => {
    event.preventDefault();

    if (modalMode === 'clone') {
      setNotice(
        'Repository cloning is not available — the backend exposes no clone endpoint. ' +
          'Clone the repository with git, then use START NEW PROJECT to register the folder.',
      );
      return;
    }

    const name = form.name.trim();
    const path = form.path.trim();
    if (!name || !path) {
      setFormError('Both a project name and a folder path are required.');
      return;
    }

    // Details are valid — detect the folder's context, then confirm it.
    setFormError(null);
    setSubmitting(true);
    let detected = {};
    try {
      const result = await detectProjectContext(path);
      if (result?.project_context && typeof result.project_context === 'object') {
        detected = result.project_context;
      }
    } catch {
      detected = {}; // best-effort: the dialog still opens if detection fails
    } finally {
      setSubmitting(false);
    }

    setDraft({ name, path });
    setContextBase(detected);
    setContextAutoDetected(Object.keys(detected).length > 0);
    setContextError(null);
    setModalMode(null);
    setContextOpen(true);
  };

  /** Cancel the context builder — go back to the (prefilled) create form. */
  const cancelContext = () => {
    if (submitting) return;
    setContextOpen(false);
    setContextError(null);
    setModalMode('project');
  };

  /**
   * "Next" in the context builder: register the project with the assembled
   * context, then open it in the workspace.
   */
  const createProject = async ({ name, path, context }) => {
    setSubmitting(true);
    setContextError(null);
    try {
      const project = await registerNew({
        projectName: name,
        folderPath: path,
        projectContext: context,
      });
      toast.success(
        project.new_project
          ? `Registered ${project.project_name}`
          : `Opened ${project.project_name}`,
        'It is now the active project.',
      );
      setContextOpen(false);
      setDraft(EMPTY_FORM);
      setForm(EMPTY_FORM);
      setContextBase({});
      setContextAutoDetected(false);
      navigate('/workspace');
    } catch (error) {
      setContextError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel =
    status === 'online' ? 'CONNECTED' : status === 'offline' ? 'OFFLINE' : 'CHECKING…';
  const dotClass =
    'connection-dot' +
    (status === 'offline'
      ? ' connection-dot--offline'
      : status === 'checking'
        ? ' connection-dot--checking'
        : '');
  const version = schema?.version ? `V${schema.version}` : '';

  return (
    <div className="launcher">
      <Topbar />

      <main className="main">
        <section className="intro">
          <div className="brand">REFACTORAI</div>
          <p>
            AI-powered multi-agent code refactoring. Open a folder, clone a repo, or
            resume a recent project.
          </p>
        </section>

        <section className="action-grid">
          <button type="button" className="action-card" onClick={() => openModal('project')}>
            <span className="action-icon">＋</span>
            <h2 className="section-title">START NEW PROJECT</h2>
            <p>Create a blank workspace folder and begin indexing.</p>
          </button>

          <button type="button" className="action-card" onClick={() => openModal('clone')}>
            <span className="action-icon">♧</span>
            <h2 className="section-title">CLONE REPOSITORY</h2>
            <p>Pull a GitHub repo into a local destination path.</p>
          </button>

          <button type="button" className="action-card" onClick={scrollToProjects}>
            <span className="action-icon">◷</span>
            <h2 className="section-title">RECENT PROJECTS</h2>
            <p>Jump straight into a previously opened workspace.</p>
          </button>
        </section>

        <section className="recent-section" id="recent-projects">
          <div className="recent-heading">
            <h2 className="section-title">RECENT</h2>
            <button
              type="button"
              className="settings-link"
              onClick={() => navigate('/settings')}
            >
              SETTINGS
            </button>
          </div>

          <div className="table-container">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>PATH</th>
                  <th>LAST OPENED</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {listState === 'loading' ? (
                  <tr>
                    <td className="table-message" colSpan={4}>
                      Loading projects…
                    </td>
                  </tr>
                ) : null}

                {listState === 'error' ? (
                  <tr>
                    <td className="table-message table-message--error" colSpan={4}>
                      Could not load projects: {listError}
                    </td>
                  </tr>
                ) : null}

                {listState === 'ready' && projects.length === 0 ? (
                  <tr>
                    <td className="table-message" colSpan={4}>
                      No projects registered yet — use START NEW PROJECT to add one.
                    </td>
                  </tr>
                ) : null}

                {listState === 'ready'
                  ? projects.map((row) => (
                      <tr key={row.project_id}>
                        <td className="name">
                          <button
                            type="button"
                            className="name-button"
                            title={`Open ${row.project_path}`}
                            disabled={Boolean(openingId)}
                            onClick={() => openRecent(row)}
                          >
                            {openingId === row.project_id
                              ? 'Opening…'
                              : row.project_name || '(unnamed)'}
                          </button>
                        </td>
                        <td className="path" title={row.project_path}>
                          {row.project_path}
                        </td>
                        <td className="date">{formatWhen(row.updated_at || row.created_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="delete-btn"
                            disabled={deletingId === row.project_id}
                            onClick={() => removeProject(row)}
                          >
                            {deletingId === row.project_id ? '…' : 'DELETE'}
                          </button>
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="connection">
          <span className={dotClass} aria-hidden="true" />
          <span>BACKEND: {statusLabel}</span>
        </div>
        <div className="version">{version}</div>
      </footer>

      {modalMode ? (
        <div
          className="modal open"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="modal-content">
            <div className="modal-heading">
              <h2>{modalMode === 'clone' ? 'CLONE REPOSITORY' : 'START NEW PROJECT'}</h2>
              <button
                type="button"
                className="close-modal"
                aria-label="Close"
                onClick={closeModal}
              >
                ×
              </button>
            </div>

            {notice ? (
              <div className="notice" role="status">
                {notice}
              </div>
            ) : null}

            <form onSubmit={submit}>
              <div className="form-field">
                <label htmlFor="project-name">
                  {modalMode === 'clone' ? 'REPO NAME' : 'PROJECT NAME'}
                </label>
                <input
                  id="project-name"
                  value={form.name}
                  placeholder={modalMode === 'clone' ? 'Repository name' : 'MyProject'}
                  disabled={submitting}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>

              <div className="form-field">
                <label htmlFor="project-path">
                  {modalMode === 'clone' ? 'REPOSITORY URL' : 'FOLDER PATH'}
                </label>
                <input
                  id="project-path"
                  value={form.path}
                  placeholder={
                    modalMode === 'clone'
                      ? 'https://github.com/user/repository.git'
                      : '/home/you/projects/my-app'
                  }
                  disabled={submitting}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, path: event.target.value }))
                  }
                />
              </div>

              {formError ? (
                <div className="form-field__error" role="alert">
                  {formError}
                </div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  CANCEL
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'WORKING…' : 'CONTINUE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {contextOpen ? (
        <ProjectContextDialog
          open
          project={draft}
          baseContext={contextBase}
          autoDetected={contextAutoDetected}
          serverError={contextError}
          loading={submitting}
          onContinue={createProject}
          onClose={cancelContext}
        />
      ) : null}
    </div>
  );
}
