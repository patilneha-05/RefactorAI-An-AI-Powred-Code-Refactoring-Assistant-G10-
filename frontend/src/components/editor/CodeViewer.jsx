import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { FileText } from 'lucide-react';
import Loader from '../common/Loader';
import EmptyState from '../common/EmptyState';
import { MONACO_THEME, languageFromFilename } from '../../lib/monaco';

/**
 * Read-only Monaco source viewer with line numbers and syntax highlighting.
 *
 * `lines` is the { lineNumber: text } map returned by POST /read_file (the keys
 * arrive as strings over JSON). `highlight` optionally marks a 1-based,
 * inclusive range { from, to } — used to point at the suggestion under review.
 */

/** Convert the { "1": "…" } map into a newline-joined document + line count. */
function toDocument(lines) {
  if (!lines) return { value: '', lineCount: 0 };
  const entries = Object.entries(lines).map(([key, text]) => [Number(key), text ?? '']);
  if (entries.length === 0) return { value: '', lineCount: 0 };
  entries.sort((a, b) => a[0] - b[0]);
  const lineCount = entries[entries.length - 1][0];
  const arr = new Array(lineCount).fill('');
  for (const [number, text] of entries) arr[number - 1] = text;
  return { value: arr.join('\n'), lineCount };
}

const EDITOR_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  lineNumbers: 'on',
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderLineHighlight: 'line',
  fontSize: 12.5,
  lineHeight: 20,
  fontFamily:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  tabSize: 4,
  insertSpaces: true,
  wordWrap: 'off',
  padding: { top: 10, bottom: 10 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  overviewRulerBorder: false,
  contextmenu: false,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  renderWhitespace: 'none',
};

export default function CodeViewer({
  filename,
  lines,
  highlight = null,
  loading = false,
  error = null,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  const { value, lineCount } = useMemo(() => toDocument(lines), [lines]);
  const language = useMemo(() => languageFromFilename(filename), [filename]);

  const handleMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsRef.current = editor.createDecorationsCollection([]);
    setMounted(true);
  }, []);

  // Keep the suggestion highlight range in sync with the editor.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const collection = decorationsRef.current;
    if (!mounted || !editor || !monaco || !collection) return;

    collection.clear();
    if (!highlight || highlight.from < 1) return;

    const last = lineCount || highlight.to;
    const from = Math.min(Math.max(1, highlight.from), last);
    const to = Math.min(Math.max(from, highlight.to), last);

    collection.set([
      {
        range: new monaco.Range(from, 1, to, 1),
        options: {
          isWholeLine: true,
          className: 'monaco-suggestion-line',
          linesDecorationsClassName: 'monaco-suggestion-gutter',
          overviewRuler: {
            color: '#10b981',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(from, monaco.editor.ScrollType.Smooth);
  }, [highlight, lineCount, mounted, value]);

  if (loading) {
    return (
      <div className="code-viewer code-viewer--state">
        <Loader label={`Loading ${filename || 'file'}…`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="code-viewer code-viewer--state">
        <div style={{ padding: 'var(--space-5)', width: '100%' }}>
          <div className="inline-alert inline-alert--error" role="alert">
            <span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!filename || lineCount === 0) {
    return (
      <div className="code-viewer code-viewer--state">
        <EmptyState
          icon={FileText}
          title="No file loaded"
          description="Pick a file from the explorer on the left, or type a project-relative path to load its source here."
        />
      </div>
    );
  }

  return (
    <div
      className="code-viewer"
      role="region"
      aria-label={`Source code of ${filename}`}
    >
      <Editor
        height="100%"
        language={language}
        theme={MONACO_THEME}
        value={value}
        onMount={handleMount}
        loading={<Loader label="Loading editor…" />}
        options={EDITOR_OPTIONS}
      />
    </div>
  );
}
