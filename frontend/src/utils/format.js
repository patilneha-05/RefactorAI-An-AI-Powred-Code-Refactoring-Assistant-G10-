/** Small presentation helpers shared across pages. */

/** Render a line range like "L12 – L18" (or "L12" when from === to). */
export function lineRange(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || a <= 0) return '—';
  if (!Number.isFinite(b) || b === a) return `L${a}`;
  return `L${a} – L${b}`;
}

/** Shorten long ids for display: 0f9f6bb7a6c3…055de0 */
export function shortId(id, head = 10) {
  if (!id) return '—';
  const text = String(id);
  return text.length <= head + 4 ? text : `${text.slice(0, head)}…${text.slice(-3)}`;
}

/** Relative time label ("just now", "5m ago", "2h ago", "3d ago"). */
export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - Number(timestamp);
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Absolute timestamp for tooltips. */
export function exactTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

/** Count files and folders in an /open_project tree (files are `null`). */
export function summarizeTree(tree) {
  let files = 0;
  let folders = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const value of Object.values(node)) {
      if (value === null) files += 1;
      else {
        folders += 1;
        walk(value);
      }
    }
  };
  walk(tree);
  return { files, folders };
}

/**
 * Extensions the backend never indexes (mirrors EXTENSIONS_TO_EXCLUDE in
 * backend/main.py). Files with these extensions are pruned from the tree, so
 * they cannot be counted — only named.
 */
export const EXCLUDED_EXTENSIONS = ['.pyc', '.pyo', '.pyd', '.so', '.dll', '.exe', '.bin'];

/**
 * Rich description of the tree returned by /open_project, used by the
 * "context building" dialog. Everything here is derived from the real tree —
 * no numbers are invented. Dotfiles and .gitignore-excluded files are pruned
 * server-side before the tree is sent, so they cannot be reported.
 */
export function describeTree(tree) {
  const files = [];
  const folders = [];
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (value === null) {
        files.push(path);
      } else {
        folders.push(path);
        walk(value, path);
      }
    }
  };
  walk(tree, '');

  const extensionCounts = new Map();
  for (const file of files) {
    const base = file.split('/').pop();
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '(none)';
    extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);
  }

  const byExtension = [...extensionCounts.entries()].sort((a, b) => b[1] - a[1]);

  return {
    files: files.length,
    folders: folders.length,
    topLevel: Object.keys(tree || {}),
    byExtension,
    languageCount: extensionCounts.size,
  };
}

/** Status label/badge mapping used by suggestion views. */
export function suggestionStatus(state) {
  switch (state) {
    case 'pending':
      return { label: 'Pending', tone: 'warning' };
    case 'accepted':
      return { label: 'Accepted', tone: 'accent' };
    case 'rejected':
      return { label: 'Rejected', tone: 'neutral' };
    default:
      return { label: state ? String(state) : 'Unknown', tone: 'neutral' };
  }
}
