import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import SuggestionReviewDialog from '../components/suggestions/SuggestionReviewDialog';
import useSuggestionActions from '../hooks/useSuggestionActions';
import { useApiStatus } from '../context/ApiStatusContext';
import { useProject } from '../context/ProjectContext';
import { useToast } from '../context/ToastContext';
import { useAgentSettings } from '../context/AgentSettings';
import { refactor } from '../services/refactorService';
import { AGENTS, instructionFor } from '../config/agents';
import { errorMessage, errorHint } from '../utils/errors';
import { languageOf, tokenizeLine } from '../utils/highlight';

/* -------------------------------------------------------------- helpers */

/** Turn the { "1": "…" } map from POST /read_file into an ordered array. */
function orderedLines(lines) {
  if (!lines) return [];
  const entries = Object.entries(lines).map(([key, text]) => [Number(key), text ?? '']);
  if (entries.length === 0) return [];
  entries.sort((a, b) => a[0] - b[0]);
  const last = entries[entries.length - 1][0];
  const arr = new Array(last).fill('');
  for (const [number, text] of entries) arr[number - 1] = text;
  return arr;
}

/** Rebuild the file's exact text from a POST /read_file payload. */
function textFromLines(file) {
  if (!file) return '';
  const text = orderedLines(file.lines).join('\n');
  return file.ends_with_newline ? `${text}\n` : text;
}

/* ---- Explorer / suggestions pane widths (persisted per browser) ---- */

const WS_LEFT_KEY = 'refactorai.workspace.left.v1';
const WS_RIGHT_KEY = 'refactorai.workspace.right.v1';
const DEFAULT_LEFT = 260;
const DEFAULT_RIGHT = 340;
const MIN_LEFT = 150;
const MIN_RIGHT = 200;
const MAX_LEFT = 560;
const MAX_RIGHT = 680;
const MIN_CENTER = 260;

const WS_TERM_KEY = 'refactorai.workspace.term.v1';
const DEFAULT_TERM = 210;
const MIN_TERM = 90;
const MAX_TERM = 560;

function loadWidth(key, fallback) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Dot colour class for the explorer (extensions without a token stay grey). */
const DOT_EXTS = [
  'py', 'json', 'csv', 'txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'css',
  'html', 'sh', 'yaml', 'yml', 'sql',
];

function dotClass(filename) {
  const base = String(filename || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = base.slice(dot + 1);
  return DOT_EXTS.includes(ext) ? ext : '';
}

/** Last four segments of an absolute path, mirroring the mock's short cwd. */
function shortPath(path) {
  if (!path) return '—';
  const parts = String(path).split('/').filter(Boolean);
  return (parts.length <= 4 ? parts : parts.slice(-4)).join('/');
}

function snip(text, max = 240) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function truncate(text, max = 90) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Display name for the agent behind a suggestion (response vs DB row). */
function agentLabel(suggestion) {
  if (suggestion.agent) return suggestion.agent;
  const match = AGENTS.find((item) => item.agentId === suggestion.agent_id);
  if (match) return match.name;
  return suggestion.agent_id || 'Agent';
}

function findingLine(suggestion) {
  const from = Number(suggestion.line_no_from);
  const to = Number(suggestion.line_no_to);
  if (!Number.isFinite(from) || from < 1) return 'line —';
  if (Number.isFinite(to) && to > from) return `lines ${from}–${to}`;
  return `line ${from}`;
}

/**
 * Priority of a finding. Agents report a free-text `severity` ("High",
 * "critical", "low", …); anything unrecognised falls back to `unknown`.
 */
function priorityOf(suggestion) {
  const raw = String(suggestion?.severity ?? suggestion?.priority ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return 'unknown';
  if (/critical|high|severe|blocker|fatal|major/.test(raw)) return 'high';
  if (/low|trivial|info|note|cosmetic|minor/.test(raw)) return 'low';
  if (/medium|moderate|warn|\bmed\b/.test(raw)) return 'medium';
  return 'unknown';
}

const PRIORITY_LABEL = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW', unknown: 'INFO' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2, unknown: 3 };

/** 1-based inclusive [from, to] span a suggestion points at, or null. */
function lineSpan(suggestion) {
  const from = Number(suggestion.line_no_from);
  if (!Number.isFinite(from) || from < 1) return null;
  let to = Number(suggestion.line_no_to);
  if (!Number.isFinite(to) || to < from) to = from;
  return [from, to];
}

/* ------------------------------------------------------------- file tree */

function TreeNodes({ tree, prefix = '', depth = 0, overrides, onToggle, selected, onSelect }) {
  const entries = Object.entries(tree || {}).sort(([, a], [, b]) => {
    const aDir = a !== null && typeof a === 'object';
    const bDir = b !== null && typeof b === 'object';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return 0;
  });

  return entries.map(([name, value]) => {
    const path = prefix ? `${prefix}/${name}` : name;
    const isDir = value !== null && typeof value === 'object';
    const indent = Math.min(depth, 3);
    const classes = ['ws-row'];
    if (isDir) classes.push('folder');
    if (indent > 0) classes.push(`indent-${indent}`);
    if (selected === path) classes.push('selected');
    const className = classes.join(' ');

    if (isDir) {
      const open = path in overrides ? overrides[path] : depth < 2;
      return (
        <div key={path}>
          <button
            type="button"
            className={className}
            aria-expanded={open}
            onClick={() => onToggle(path, depth)}
          >
            <span className="ws-arrow" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            <span>{name}</span>
          </button>
          {open ? (
            <TreeNodes
              tree={value}
              prefix={path}
              depth={depth + 1}
              overrides={overrides}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
            />
          ) : null}
        </div>
      );
    }

    return (
      <button
        key={path}
        type="button"
        className={className}
        title={path}
        aria-current={selected === path ? 'true' : undefined}
        onClick={() => onSelect(path)}
      >
        <span className={`ws-dot ${dotClass(name)}`} aria-hidden="true" />
        <span>{name}</span>
      </button>
    );
  });
}

/* -------------------------------------------------------- history session */

function Finding({ item, onOpen }) {
  const state = ['pending', 'accepted', 'rejected'].includes(item.suggestion_state)
    ? item.suggestion_state
    : 'pending';
  const priority = priorityOf(item);
  const meta = [agentLabel(item), item.filename, findingLine(item)]
    .filter(Boolean)
    .join(' · ');
  const title =
    item.suggestion_title || truncate(item.suggestion_description) || 'Refactoring suggestion';

  return (
    <article
      className="ws-finding"
      role="button"
      tabIndex={0}
      title="Open suggestion details"
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="ws-finding-top">
        <span className="ws-finding-title">{title}</span>
        <span className={`ws-badge ${state}`}>{state.toUpperCase()}</span>
      </div>
      <div className="ws-finding-meta">
        <span className={`ws-priority ${priority}`}>{PRIORITY_LABEL[priority]}</span>
        <span>{meta}</span>
      </div>
    </article>
  );
}

/* =========================================================== the screen */

/**
 * Workspace / code editor — the supplied design, rendered verbatim and wired
 * to the real backend:
 *   explorer     → tree from POST /open_project, files via POST /read_file
 *   REFACTOR     → POST /refactor (agent picked from the registry)
 *   suggestions  → the findings returned by previous /refactor runs
 *   status bar   → GET /openapi.json via ApiStatusContext
 *
 * The backend exposes no git integration, so the design's `no-git` badge and
 * the "N agents" counter are reported honestly rather than faked.
 */
export default function Workspace() {
  const navigate = useNavigate();
  const toast = useToast();
  const { status } = useApiStatus();
  const {
    activeProject,
    currentFile,
    loadFile,
    refreshFile,
    saveFile,
    fileLoading,
    fileError,
    clearFileError,
    openExisting,
    recordRefactorRun,
    activeSuggestions,
  } = useProject();

  const actions = useSuggestionActions({ onResolved: () => setSelected(null) });

  const { isEnabled } = useAgentSettings();

  const [tabOpen, setTabOpen] = useState(true);

  const [refactorLoading, setRefactorLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [selected, setSelected] = useState(null);

  const [termVisible, setTermVisible] = useState(true);
  const [termMax, setTermMax] = useState(false);
  const [treeOverrides, setTreeOverrides] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  // ---- editable buffer ----
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const draftRef = useRef('');
  const lastFileKeyRef = useRef('');
  const lastServerTextRef = useRef('');

  // ---- resizable panes ----
  const workspaceRef = useRef(null);
  const centerRef = useRef(null);
  const [leftWidth, setLeftWidth] = useState(() => loadWidth(WS_LEFT_KEY, DEFAULT_LEFT));
  const [rightWidth, setRightWidth] = useState(() => loadWidth(WS_RIGHT_KEY, DEFAULT_RIGHT));
  const [termHeight, setTermHeight] = useState(() => loadWidth(WS_TERM_KEY, DEFAULT_TERM));
  const [dragging, setDragging] = useState(null);

  const pushLog = useCallback((text, tone = null) => {
    setLog((prev) => [...prev, { text, tone }].slice(-40));
  }, []);

  const go = useCallback((path) => navigate(path), [navigate]);

  const serverText = useMemo(() => textFromLines(currentFile), [currentFile]);
  const fileKey = currentFile ? `${currentFile.project_id}:${currentFile.filename}` : '';
  const dirty = Boolean(currentFile) && draft !== serverText;

  // Keep the ref (used by the sync effect) in step with the latest draft.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Load the file into the editor; refresh it in place when the backend
  // changes it (e.g. accepting a suggestion) as long as there is no local edit.
  useEffect(() => {
    if (!currentFile) {
      lastFileKeyRef.current = '';
      lastServerTextRef.current = '';
      setDraft('');
      return;
    }
    if (fileKey !== lastFileKeyRef.current) {
      lastFileKeyRef.current = fileKey;
      lastServerTextRef.current = serverText;
      setDraft(serverText);
      return;
    }
    if (draftRef.current === lastServerTextRef.current) {
      setDraft(serverText);
    }
    lastServerTextRef.current = serverText;
  }, [currentFile, fileKey, serverText]);

  // Persist pane widths between sessions.
  useEffect(() => {
    try {
      window.localStorage.setItem(WS_LEFT_KEY, String(leftWidth));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [leftWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WS_RIGHT_KEY, String(rightWidth));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [rightWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WS_TERM_KEY, String(termHeight));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [termHeight]);

  const save = useCallback(async () => {
    if (!currentFile || saving) return;
    if (draft === serverText) {
      toast.info('Nothing to save', 'The file has no unsaved changes.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveFile(draft);
      pushLog(`saved ${currentFile.filename} · ${result.total_lines} lines`, 'ok');
      toast.success('File saved', currentFile.filename);
    } catch (error) {
      pushLog(`save failed — ${errorMessage(error)}`, 'error');
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setSaving(false);
    }
  }, [currentFile, saving, draft, serverText, saveFile, pushLog, toast]);

  // Ctrl/Cmd+S anywhere in the workspace saves the open file.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [save]);

  const onEditorKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const el = event.target;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${draft.slice(0, start)}    ${draft.slice(end)}`;
      setDraft(next);
      draftRef.current = next;
      window.requestAnimationFrame(() => {
        const node = editorRef.current;
        if (node) {
          node.selectionStart = start + 4;
          node.selectionEnd = start + 4;
        }
      });
    },
    [draft],
  );

  /* ---- pane resizing ---- */

  const workspaceWidth = useCallback(
    () => workspaceRef.current?.getBoundingClientRect().width || window.innerWidth,
    [],
  );

  const beginDrag = useCallback((move, side, cursor = 'col-resize') => {
    const onMove = (event) => move(event);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    setDragging(side);
  }, []);

  const startResize = useCallback((side) => (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const total = workspaceWidth();
    if (side === 'left') {
      const start = leftWidth;
      const max = Math.max(MIN_LEFT, Math.min(MAX_LEFT, total - rightWidth - MIN_CENTER));
      beginDrag(
        (moveEvent) => setLeftWidth(clamp(start + (moveEvent.clientX - startX), MIN_LEFT, max)),
        'left',
      );
    } else {
      const start = rightWidth;
      const max = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, total - leftWidth - MIN_CENTER));
      beginDrag(
        (moveEvent) => setRightWidth(clamp(start - (moveEvent.clientX - startX), MIN_RIGHT, max)),
        'right',
      );
    }
  }, [leftWidth, rightWidth, beginDrag, workspaceWidth]);

  const nudge = useCallback(
    (side, change, event) => {
      event.preventDefault();
      const total = workspaceWidth();
      if (side === 'left') {
        const max = Math.max(MIN_LEFT, Math.min(MAX_LEFT, total - rightWidth - MIN_CENTER));
        setLeftWidth((value) => clamp(value + change, MIN_LEFT, max));
      } else {
        const max = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, total - leftWidth - MIN_CENTER));
        setRightWidth((value) => clamp(value + change, MIN_RIGHT, max));
      }
    },
    [leftWidth, rightWidth, workspaceWidth],
  );

  /* ---- terminal resizing (vertical drag between editor and terminal) ---- */

  const startTermResize = useCallback(
    (downEvent) => {
      downEvent.preventDefault();
      const startY = downEvent.clientY;
      const start = termHeight;
      const available = centerRef.current?.getBoundingClientRect().height || window.innerHeight;
      const max = Math.max(MIN_TERM, Math.min(MAX_TERM, available - 140));
      beginDrag((moveEvent) => {
        setTermHeight(clamp(start - (moveEvent.clientY - startY), MIN_TERM, max));
      }, 'terminal', 'row-resize');
    },
    [termHeight, beginDrag],
  );

  const nudgeTerm = useCallback((change, event) => {
    event.preventDefault();
    const available = centerRef.current?.getBoundingClientRect().height || window.innerHeight;
    const max = Math.max(MIN_TERM, Math.min(MAX_TERM, available - 140));
    setTermHeight((value) => clamp(value + change, MIN_TERM, max));
  }, []);

  const draftLines = useMemo(() => (draft ? draft.split('\n') : []), [draft]);

  const tokensByLine = useMemo(() => {
    if (!currentFile || draftLines.length === 0) return [];
    const lang = languageOf(currentFile.filename);
    return draftLines.map((line) => tokenizeLine(line, lang));
  }, [currentFile, draftLines]);

  // Source lines referenced by pending suggestions of the file on screen. The
  // design marks these in red; accepting a suggestion clears its mark (the
  // suggestion is no longer pending and the file is re-read).
  const flaggedLines = useMemo(() => {
    const flagged = new Set();
    if (!currentFile) return flagged;
    for (const item of activeSuggestions) {
      if (item.suggestion_state !== 'pending') continue;
      if (item.filename !== currentFile.filename) continue;
      if (
        item.project_id &&
        currentFile.project_id &&
        item.project_id !== currentFile.project_id
      ) {
        continue;
      }
      const span = lineSpan(item);
      if (!span) continue;
      for (let n = span[0]; n <= span[1]; n += 1) flagged.add(n);
    }
    return flagged;
  }, [activeSuggestions, currentFile]);

  // The right sidebar lists only the pending suggestions — once one is
  // accepted (or rejected) it drops out. Highest priority first, then the
  // most recent run, then position in the file.
  const orderedSuggestions = useMemo(
    () =>
      activeSuggestions
        .filter((item) => item.suggestion_state === 'pending')
        .sort(
          (a, b) =>
            PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)] ||
            (b.receivedAt || 0) - (a.receivedAt || 0) ||
            (Number(a.line_no_from) || 0) - (Number(b.line_no_from) || 0),
        ),
    [activeSuggestions],
  );

  const handleRead = useCallback(
    async (path) => {
      if (!activeProject) {
        toast.error('No active project', 'Open a project from the launcher first.');
        return;
      }
      clearFileError();
      try {
        const file = await loadFile(path);
        setTabOpen(true);
        pushLog(`read ${path} · ${file.total_lines} lines`);
      } catch (error) {
        pushLog(`read failed: ${path} — ${errorMessage(error)}`, 'error');
        toast.error(errorMessage(error), errorHint(error) || undefined);
      }
    },
    [activeProject, loadFile, clearFileError, pushLog, toast],
  );

  const handleReload = useCallback(async () => {
    if (!currentFile) return;
    const file = await refreshFile();
    if (file) pushLog(`reloaded ${file.filename} · ${file.total_lines} lines`);
  }, [currentFile, refreshFile, pushLog]);

  const handleRefreshTree = useCallback(async () => {
    if (!activeProject || refreshing) return;
    setRefreshing(true);
    try {
      const project = await openExisting(activeProject.project_id);
      const summary = Object.keys(project.tree || {}).length;
      pushLog(`refreshed tree · ${summary} top-level entries`);
    } catch (error) {
      pushLog(`tree refresh failed — ${errorMessage(error)}`, 'error');
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setRefreshing(false);
    }
  }, [activeProject, refreshing, openExisting, pushLog, toast]);

  const runEnabledAgents = useCallback(async () => {
    if (!activeProject || !currentFile) return;

    const enabled = AGENTS.filter((agent) => isEnabled(agent.agentId));
    if (enabled.length === 0) {
      pushLog('no agents enabled — turn one on in SETTINGS → AGENT PIPELINE', 'error');
      toast.info(
        'No agents enabled',
        'Enable at least one agent in Settings → Agent Pipeline.',
      );
      return;
    }

    setRefactorLoading(true);
    pushLog(
      `analyze ${currentFile.filename} — ${enabled.length} agent(s): ${enabled
        .map((agent) => agent.name)
        .join(', ')}…`,
      'muted',
    );

    let total = 0;
    try {
      for (const agent of enabled) {
        pushLog(`refactor ${currentFile.filename} — ${agent.name}…`, 'muted');
        try {
          const data = await refactor({
            projectId: activeProject.project_id,
            filename: currentFile.filename,
            agentId: agent.agentId,
            userMessage: instructionFor(agent),
          });
          const count = recordRefactorRun({
            projectId: activeProject.project_id,
            filename: currentFile.filename,
            agent: data.agent,
            model: data.model,
            list: data.suggestions || [],
          });
          total += count;
          pushLog(
            `${data.agent} · ${data.model || 'model unknown'} · ${count} suggestion(s)`,
            count > 0 ? 'ok' : 'muted',
          );
          if (data.output) pushLog(snip(data.output));
          if (data.error?.message) pushLog(`warning: ${data.error.message}`, 'error');
        } catch (error) {
          pushLog(`${agent.name} failed — ${errorMessage(error)}`, 'error');
          toast.error(errorMessage(error), errorHint(error) || undefined);
        }
      }

      if (total > 0) {
        toast.success(
          `Refactoring complete — ${total} suggestion${total === 1 ? '' : 's'}`,
          `${enabled.length} agent(s) ran`,
        );
      } else {
        toast.info(
          'No suggestions returned',
          'The enabled agents finished without proposing any changes.',
        );
      }
    } finally {
      setRefactorLoading(false);
    }
  }, [activeProject, currentFile, isEnabled, recordRefactorRun, pushLog, toast]);

  /* ---- derived display values ---- */

  const projectPath = activeProject?.project_path || 'no active project';
  const tree = activeProject?.tree || {};
  const hasTree = Object.keys(tree).length > 0;

  const codeState = !activeProject
    ? 'no-project'
    : fileLoading
      ? 'loading'
      : fileError
        ? 'error'
        : !currentFile || !tabOpen
          ? 'no-file'
          : 'code';

  const tabLabel = currentFile && tabOpen ? currentFile.filename : 'No file';

  const statusDot =
    status === 'offline'
      ? ' ws-status-dot--offline'
      : status === 'checking'
        ? ' ws-status-dot--checking'
        : '';
  const connectionLabel =
    status === 'online' ? 'connected' : status === 'offline' ? 'offline' : 'checking';
  const backendPill =
    status === 'online'
      ? 'ws-backend-pill'
      : status === 'offline'
        ? 'ws-backend-pill ws-backend-pill--offline'
        : 'ws-backend-pill ws-backend-pill--checking';
  const backendText =
    status === 'online' ? '✓ | backend ▯' : status === 'offline' ? '× | backend ▯' : '· | backend ▯';

  return (
    <div className="ws-screen">
      {/* ---------------------------------------------------- navigation bar */}
      <Topbar
        terminal={{
          visible: termVisible,
          maximized: termMax,
          onToggleVisibility: () => setTermVisible((value) => !value),
          onToggleMaximize: () => setTermMax((value) => !value),
        }}
        onReloadFile={handleReload}
      />

      {/* ------------------------------------------------------ workspace */}
      <main
        className="ws-workspace"
        ref={workspaceRef}
        style={{ '--ws-left': `${leftWidth}px`, '--ws-right': `${rightWidth}px` }}
      >
        {/* explorer */}
        <aside className="ws-explorer" aria-label="Project files">
          <div className="ws-panel-heading">
            <span>EXPLORER</span>
            <button
              type="button"
              className="ws-panel-action"
              title="Refresh the file tree"
              disabled={!activeProject || refreshing}
              onClick={handleRefreshTree}
            >
              {refreshing ? '⋯' : '↻'}
            </button>
          </div>

          <div className="ws-tree">
            {!activeProject ? (
              <div className="ws-tree-empty">
                No project open. Use FILE → OPEN / REGISTER PROJECT… to pick one.
              </div>
            ) : !hasTree ? (
              <div className="ws-tree-empty">
                This project reported an empty tree. Re-open it from the launcher.
              </div>
            ) : (
              <TreeNodes
                tree={tree}
                overrides={treeOverrides}
                onToggle={(path, depth) =>
                  setTreeOverrides((prev) => ({
                    ...prev,
                    [path]: !(path in prev ? prev[path] : depth < 2),
                  }))
                }
                selected={tabOpen ? currentFile?.filename : undefined}
                onSelect={handleRead}
              />
            )}
          </div>
        </aside>

        <div
          className={`ws-resizer ws-resizer--v${dragging === 'left' ? ' ws-resizer--active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer"
          tabIndex={0}
          onPointerDown={startResize('left')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') nudge('left', -16, event);
            else if (event.key === 'ArrowRight') nudge('left', 16, event);
          }}
        />

        {/* editor + terminal */}
        <section
          className={`ws-center${termMax ? ' ws-center--term-max' : ''}`}
          aria-label="Source code"
          ref={centerRef}
          style={{ '--ws-term-height': `${termHeight}px` }}
        >
          <div className="ws-editor-top">
            <div className="ws-tabs">
              <div className="ws-tab">
                <span className="ws-tab-name">
                  {tabLabel}
                  {dirty ? (
                    <span className="ws-tab-dirty" title="Unsaved changes">
                      ●
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="ws-tab-close"
                  aria-label="Close file"
                  onClick={() => setTabOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="ws-editor-actions">
              <button
                type="button"
                className={`ws-save-btn${dirty ? ' ws-save-btn--dirty' : ''}`}
                disabled={!currentFile || saving || !dirty}
                title={
                  dirty && currentFile
                    ? `Save ${currentFile.filename} (Ctrl/Cmd+S)`
                    : 'No unsaved changes'
                }
                onClick={save}
              >
                {saving ? 'SAVING…' : 'SAVE'}
              </button>

              <button
                type="button"
                className="ws-refactor-btn"
                disabled={refactorLoading || !currentFile}
                title={
                  currentFile
                    ? `Run the enabled agents on ${currentFile.filename}`
                    : 'Select a source file to refactor'
                }
                onClick={runEnabledAgents}
              >
                REFACTOR
              </button>
            </div>
          </div>

          <div className="ws-code-area">
            <div className="ws-code-content">
              {codeState === 'no-project' ? (
                <div className="ws-code-state">
                  <div>No active project.</div>
                  <div className="ws-code-state-actions">
                    <button
                      type="button"
                      className="ws-btn ws-btn--primary"
                      onClick={() => go('/projects')}
                    >
                      OPEN PROJECT
                    </button>
                    <button type="button" className="ws-btn" onClick={() => go('/')}>
                      DASHBOARD
                    </button>
                  </div>
                </div>
              ) : null}

              {codeState === 'loading' ? (
                <div className="ws-code-state">
                  Reading {currentFile?.filename || 'file'}…
                </div>
              ) : null}

              {codeState === 'error' ? (
                <div className="ws-code-state ws-code-state--error" role="alert">
                  {fileError}
                </div>
              ) : null}

              {codeState === 'no-file' ? (
                <div className="ws-code-state">Open a file from the explorer</div>
              ) : null}

              {codeState === 'code' ? (
                <div className="ws-code-editor">
                  <div className="ws-code-highlight" aria-hidden="true">
                    {tokensByLine.map((tokens, index) => {
                      const lineNo = index + 1;
                      const flagged = flaggedLines.has(lineNo);
                      return (
                        <div
                          className={`ws-code-line${index === 0 ? ' active-line' : ''}${
                            flagged ? ' ws-code-line--flag' : ''
                          }`}
                          key={index}
                        >
                          <span className={`ws-lineno${index === 0 ? ' current' : ''}`}>
                            {lineNo}
                          </span>
                          <span className="ws-code-text">
                            {tokens.length === 0
                              ? '\u00a0'
                              : tokens.map((token, position) =>
                                  token.c ? (
                                    <span className={token.c} key={position}>
                                      {token.t}
                                    </span>
                                  ) : (
                                    token.t
                                  ),
                                )}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <textarea
                    ref={editorRef}
                    className="ws-code-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onEditorKeyDown}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    wrap="off"
                    aria-label={currentFile ? `Edit ${currentFile.filename}` : 'Code editor'}
                  />
                </div>
              ) : null}
            </div>

            <div className="ws-minimap" aria-hidden="true">
              {codeState === 'code'
                ? draftLines.map((line, index) => (
                    <div
                      className="ws-mini"
                      key={index}
                      style={{
                        width: `${Math.max(20, Math.min(100, line.length * 1.1))}%`,
                      }}
                    />
                  ))
                : null}
            </div>
          </div>

          {termVisible && !termMax ? (
            <div
              className={`ws-resizer ws-resizer--h${
                dragging === 'terminal' ? ' ws-resizer--active' : ''
              }`}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize terminal"
              tabIndex={0}
              onPointerDown={startTermResize}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') nudgeTerm(48, event);
                else if (event.key === 'ArrowDown') nudgeTerm(-48, event);
              }}
            />
          ) : null}

          {termVisible ? (
            <section
              className={`ws-terminal${termMax ? ' ws-terminal--max' : ''}`}
              aria-label="Terminal"
            >
              <div className="ws-term-head">
                <div className="ws-term-title">TERMINAL</div>
                <div className="ws-term-tools">
                  <button
                    type="button"
                    title="Clear terminal output"
                    onClick={() => setLog([])}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    title={termMax ? 'Restore terminal' : 'Maximize terminal'}
                    onClick={() => setTermMax((value) => !value)}
                  >
                    □
                  </button>
                  <button
                    type="button"
                    title="Close terminal"
                    onClick={() => {
                      setTermVisible(false);
                      setTermMax(false);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="ws-term-body">
                <div className="ws-term-path">Terminal attached to {projectPath}</div>

                <div className="ws-term-log">
                  {log.map((entry, index) => (
                    <div
                      className={`ws-term-log-line${
                        entry.tone ? ` ws-term-log-line--${entry.tone}` : ''
                      }`}
                      key={index}
                    >
                      {entry.text}
                    </div>
                  ))}
                </div>

                <div className="ws-term-prompt">
                  <div className="ws-prompt-left">
                    <span className="ws-prompt-caret">▯</span>
                    <span className="ws-prompt-path">{shortPath(activeProject?.project_path)}</span>
                    <span>▥</span>
                  </div>
                  <span className={backendPill}>{backendText}</span>
                </div>
              </div>
            </section>
          ) : null}
        </section>

        <div
          className={`ws-resizer ws-resizer--v${dragging === 'right' ? ' ws-resizer--active' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize suggestions"
          tabIndex={0}
          onPointerDown={startResize('right')}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') nudge('right', 16, event);
            else if (event.key === 'ArrowRight') nudge('right', -16, event);
          }}
        />

        {/* suggestions */}
        <aside className="ws-history" aria-label="Suggestions">
          <div className="ws-hist-body">
            {orderedSuggestions.map((item) => (
              <Finding key={item.suggestion_id} item={item} onOpen={(s) => setSelected(s)} />
            ))}
          </div>
        </aside>
      </main>

      {/* ----------------------------------------------------- status bar */}
      <footer className="ws-statusbar">
        <div className="ws-status-left">
          <span>▯ no-git</span>
        </div>

        <div className="ws-status-right">
          <span>
            {refactorLoading ? <span className="ws-status-amber">Analyzing…</span> : 'Ready'}
          </span>
          <span>{AGENTS.length} agents</span>
          <span role="status">
            <i className={`ws-status-dot${statusDot}`} aria-hidden="true" />
            {connectionLabel}
          </span>
        </div>
      </footer>

      <SuggestionReviewDialog
        suggestion={selected}
        actions={actions}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
