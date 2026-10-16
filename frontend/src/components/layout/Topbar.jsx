import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { errorMessage, errorHint } from '../../utils/errors';
import { shortId } from '../../utils/format';

/* ------------------------------------------------- menubar building blocks */

function Menu({ id, openId, setOpenId, label, children, align = 'left' }) {
  const open = openId === id;
  return (
    <div className="ws-menu">
      <button
        type="button"
        className="ws-menu-item"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
      >
        {label}
      </button>
      {open ? (
        <div
          className={`ws-menu-panel${align === 'right' ? ' ws-menu-panel--right' : ''}`}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ label, sub, hint, ...rest }) {
  return (
    <button type="button" role="menuitem" className="ws-dd-item" {...rest}>
      <span className="ws-dd-item__meta">
        <strong>{label}</strong>
        {sub ? <span>{sub}</span> : null}
      </span>
      {hint ? <span className="ws-dd-item__hint">{hint}</span> : null}
    </button>
  );
}

const MenuSep = () => <div className="ws-menu-sep" role="separator" />;

const WINDOW_ITEMS = [
  { path: '/', label: 'DASHBOARD', hint: '/' },
  { path: '/projects', label: 'PROJECTS', hint: '/projects' },
  { path: '/workspace', label: 'WORKSPACE', hint: '/workspace' },
  { path: '/suggestions', label: 'SUGGESTIONS', hint: '/suggestions' },
  { path: '/settings', label: 'SETTINGS', hint: '/settings' },
];

/**
 * The application navigation bar: the workspace design's `ws-topbar`
 * (FILE / EDIT / VIEW / WINDOW) rendered on every screen, branded REFACTORAI.
 *
 * Terminal controls only exist in the workspace, so they are injected through
 * the optional `terminal` prop. `onReloadFile` lets the workspace mirror
 * EDIT → RELOAD FILE into its terminal log.
 */
export default function Topbar({ terminal = null, onReloadFile = null }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const { user, logout } = useAuth();
  const {
    activeProject,
    projectHistory,
    currentFile,
    fileLoading,
    refreshFile,
    openExisting,
  } = useProject();

  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  // Close the dropdowns on an outside click / Escape, wherever the bar is used.
  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openMenu]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = useCallback(
    (path) => {
      setOpenMenu(null);
      navigate(path);
    },
    [navigate],
  );

  const switchProject = useCallback(
    async (item) => {
      setOpenMenu(null);
      if (!item.project_id || item.project_id === activeProject?.project_id) return;
      try {
        const project = await openExisting(item.project_id);
        toast.success(`Switched to ${project.project_name}`);
        navigate('/workspace');
      } catch (error) {
        toast.error(errorMessage(error), errorHint(error) || undefined);
      }
    },
    [activeProject, openExisting, navigate, toast],
  );

  const reloadFile = useCallback(async () => {
    setOpenMenu(null);
    if (onReloadFile) {
      await onReloadFile();
      return;
    }
    const file = await refreshFile();
    if (file) toast.success('File reloaded', file.filename);
  }, [onReloadFile, refreshFile, toast]);

  const copyFilePath = useCallback(() => {
    if (!activeProject || !currentFile) return;
    const value = `${activeProject.project_path}/${currentFile.filename}`;
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success('Path copied', value))
      .catch(() => toast.error('Could not copy the path'));
    setOpenMenu(null);
  }, [activeProject, currentFile, toast]);

  const handleLogout = useCallback(async () => {
    setOpenMenu(null);
    await logout();
    toast.info('Signed out');
    navigate('/login', { replace: true });
  }, [logout, navigate, toast]);

  const accountLabel = (user?.full_name || user?.email || 'ACCOUNT').toUpperCase();

  return (
    <header className="ws-topbar" ref={menuRef}>
      <nav className="ws-menu-left" aria-label="Application menu">
        <Link to="/" className="ws-brand" aria-label="RefactorAI dashboard">
          REFACTORAI
        </Link>

        <Menu id="file" openId={openMenu} setOpenId={setOpenMenu} label="FILE">
          <MenuItem
            label="OPEN / REGISTER PROJECT…"
            hint="/projects"
            onClick={() => go('/projects')}
          />
          <MenuSep />
          <div className="ws-menu-label">RECENT</div>
          {projectHistory.length === 0 ? (
            <MenuItem label="No projects opened in this browser" disabled />
          ) : (
            projectHistory.slice(0, 5).map((item) => (
              <MenuItem
                key={item.project_id}
                label={item.project_name || '(unnamed)'}
                sub={shortId(item.project_id, 8)}
                hint={item.project_id === activeProject?.project_id ? 'ACTIVE' : ''}
                onClick={() => switchProject(item)}
              />
            ))
          )}
          <MenuSep />
          <MenuItem label="BACK TO DASHBOARD" hint="/" onClick={() => go('/')} />
        </Menu>

        <Menu id="edit" openId={openMenu} setOpenId={setOpenMenu} label="EDIT">
          <MenuItem
            label="RELOAD FILE"
            sub={currentFile?.filename}
            disabled={!currentFile || fileLoading}
            onClick={reloadFile}
          />
          <MenuItem
            label="COPY FILE PATH"
            disabled={!activeProject || !currentFile}
            onClick={copyFilePath}
          />
        </Menu>

        <Menu id="view" openId={openMenu} setOpenId={setOpenMenu} label="VIEW">
          {terminal ? (
            <>
              <MenuItem
                label={terminal.visible ? 'HIDE TERMINAL' : 'SHOW TERMINAL'}
                onClick={() => {
                  setOpenMenu(null);
                  terminal.onToggleVisibility();
                }}
              />
              <MenuItem
                label={terminal.maximized ? 'RESTORE TERMINAL' : 'MAXIMIZE TERMINAL'}
                disabled={!terminal.visible}
                onClick={() => {
                  setOpenMenu(null);
                  terminal.onToggleMaximize();
                }}
              />
              <MenuSep />
            </>
          ) : null}
          <MenuItem
            label="SUGGESTION LIST"
            hint="/suggestions"
            onClick={() => go('/suggestions')}
          />
          <MenuItem label="SETTINGS" hint="/settings" onClick={() => go('/settings')} />
        </Menu>

        <Menu id="window" openId={openMenu} setOpenId={setOpenMenu} label="WINDOW">
          {WINDOW_ITEMS.map((item) => (
            <MenuItem
              key={item.path}
              label={item.label}
              hint={item.hint}
              disabled={pathname === item.path}
              onClick={() => go(item.path)}
            />
          ))}
        </Menu>
      </nav>

      <div className="ws-menu-right">
        <span className="ws-project-title">
          {activeProject ? activeProject.project_name : 'No project'}
        </span>
        <span className="ws-git-badge" title="The backend exposes no git integration">
          ▯ no-git
        </span>
        <Menu id="account" openId={openMenu} setOpenId={setOpenMenu} label={accountLabel} align="right">
          {user?.full_name ? <div className="ws-menu-label">{user.full_name}</div> : null}
          <MenuItem label={user?.email || 'Signed in'} disabled />
          <MenuSep />
          <MenuItem label="SIGN OUT" hint="logout" onClick={handleLogout} />
        </Menu>
      </div>
    </header>
  );
}
