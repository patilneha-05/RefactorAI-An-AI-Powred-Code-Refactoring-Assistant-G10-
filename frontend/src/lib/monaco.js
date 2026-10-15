/**
 * Monaco Editor bootstrap.
 *
 * Monaco ships its own web workers for each language service. Vite exposes
 * them through `?worker` imports, and `MonacoEnvironment.getWorker` tells the
 * editor which one to run for a given language. Without this, Monaco falls
 * back to loading language workers from a CDN, which breaks offline/first-run.
 *
 * Importing this module once (side effect) also registers the custom light
 * theme that matches the RefactorAI design tokens, and re-points
 * `@monaco-editor/react`'s loader at the locally bundled instance instead of
 * the default jsDelivr CDN.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

/* eslint-disable no-restricted-globals */
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};
/* eslint-enable no-restricted-globals */

/** Name of the custom Monaco theme registered below. */
export const MONACO_THEME = 'refactorai-light';

monaco.editor.defineTheme(MONACO_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ffb52e', fontStyle: 'bold' },
    { token: 'string', foreground: '54d6b0' },
    { token: 'number', foreground: '6aa9ff' },
    { token: 'type', foreground: 'ffd479' },
    { token: 'function', foreground: '8fd0ff' },
    { token: 'variable', foreground: 'e5e7eb' },
    { token: 'constant', foreground: '6aa9ff' },
    { token: 'operator', foreground: 'b7bcc4' },
    { token: 'delimiter', foreground: '858b96' },
  ],
  colors: {
    'editor.background': '#0e1014',
    'editor.foreground': '#e5e7eb',
    'editorLineNumber.foreground': '#5f6672',
    'editorLineNumber.activeForeground': '#ffb52e',
    'editorGutter.background': '#0e1014',
    'editor.lineHighlightBackground': '#14171d',
    'editor.selectionBackground': '#3a2f14',
    'editor.inactiveSelectionBackground': '#241f12',
    'editorCursor.foreground': '#ffb52e',
    'editorIndentGuide.background1': '#1c2128',
    'editorIndentGuide.activeBackground1': '#303640',
    'editorWidget.background': '#111419',
    'editorWidget.border': '#252a31',
    'editorSuggestWidget.background': '#111419',
    'editorOverviewRuler.border': '#00000000',
    'scrollbarSlider.background': '#30364080',
    'scrollbarSlider.hoverBackground': '#5f667280',
    'scrollbarSlider.activeBackground': '#858b9680',
    'editorBracketMatch.background': '#241f12',
    'editorBracketMatch.border': '#ffb52e',
  },
});

// Use the locally bundled Monaco (workers + languages above) rather than CDN.
loader.config({ monaco });

/** Map a filename to a Monaco language id (best-effort, defaults to plaintext). */
export function languageFromFilename(filename) {
  if (!filename) return 'plaintext';
  const base = String(filename).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    // Recognise a few well-known extension-less files.
    const bare = base.toLowerCase();
    if (bare === 'dockerfile') return 'dockerfile';
    if (bare === 'makefile') return 'makefile';
    return 'plaintext';
  }
  const ext = base.slice(dot + 1).toLowerCase();

  const BY_EXT = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    jsonc: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    cfg: 'ini',
    xml: 'xml',
    svg: 'xml',
    vue: 'html',
    dockerfile: 'dockerfile',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    pl: 'perl',
    ex: 'elixir',
    exs: 'elixir',
    clj: 'clojure',
    hs: 'haskell',
    tf: 'hcl',
    proto: 'protobuf',
  };

  return BY_EXT[ext] || 'plaintext';
}
