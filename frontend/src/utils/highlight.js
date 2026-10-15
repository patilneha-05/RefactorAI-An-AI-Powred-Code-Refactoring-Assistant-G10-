/**
 * Minimal, dependency-free syntax highlighter for the workspace's code pane.
 *
 * The supplied editor design renders code as `<span class="kw|mod|str|num|fn|
 * comment|const|op">` fragments inside `.code-line` rows. Monaco (used by the
 * previous workspace) paints its own DOM and cannot reproduce that markup, so
 * the design's own token palette is implemented here instead.
 *
 * The output is a list of `{ t, c }` tokens rendered by React — source text is
 * NEVER injected as HTML, so file contents stay inert.
 */

const KEYWORDS = {
  python: new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
    'raise', 'return', 'try', 'while', 'with', 'yield',
    // builtins the mock highlights as keywords
    'abs', 'all', 'any', 'bool', 'bytes', 'callable', 'chr', 'dict', 'dir',
    'enumerate', 'eval', 'filter', 'float', 'format', 'frozenset', 'getattr',
    'hasattr', 'hash', 'id', 'input', 'int', 'isinstance', 'issubclass',
    'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object', 'open',
    'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round',
    'set', 'setattr', 'slice', 'sorted', 'str', 'sum', 'super', 'tuple',
    'type', 'vars', 'zip',
  ]),
  js: new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
    'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw',
    'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'alert', 'console', 'document', 'window',
  ]),
  json: new Set(),
  md: new Set(),
  shell: new Set([
    'case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function',
    'if', 'in', 'select', 'then', 'time', 'until', 'while',
  ]),
  generic: new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
    'func', 'function', 'goto', 'if', 'implements', 'import', 'interface',
    'let', 'package', 'private', 'protected', 'public', 'return', 'static',
    'struct', 'switch', 'this', 'throw', 'throws', 'try', 'typedef', 'union',
    'var', 'while', 'def', 'elif', 'lambda', 'pass', 'print', 'raise',
    'require', 'template', 'use', 'match', 'impl', 'fn', 'attr',
  ]),
};

const CONSTANTS = {
  python: ['True', 'False', 'None', 'NotImplemented', 'Ellipsis', '__name__', '__file__'],
  js: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'globalThis'],
  json: ['true', 'false', 'null'],
  md: ['true', 'false', 'null'],
  shell: ['true', 'false'],
  generic: ['true', 'false', 'null', 'True', 'False', 'None', 'undefined'],
};

const LINE_COMMENTS = {
  python: ['#'],
  js: ['//'],
  json: [],
  md: ['#'],
  shell: ['#'],
  generic: ['#', '//'],
};

const BLOCK_COMMENTS = {
  python: null,
  js: ['/*', '*/'],
  json: null,
  md: ['<!--', '-->'],
  shell: null,
  generic: ['/*', '*/'],
};

const STRING_QUOTES = {
  python: ['"', "'", '`'],
  js: ['"', "'", '`'],
  json: ['"'],
  md: ['"', "'"],
  shell: ['"', "'"],
  generic: ['"', "'", '`'],
};

/** JSON object keys read as strings (the design colours them `str`). */
const JSON_KEY_RE = /^"(?:[^"\\]|\\.)*"(?=\s*:)/;

const IDENT_START = /[A-Za-z_$]/;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /^(?:[0-9][0-9_]*)(?:\.[0-9_]+)?(?:[eE][+-]?[0-9]+)?[jJ]?/;
const OP_RE = /^[=+\-*/%<>!&|^~?:.,;()[\]{}]+/;

/** Guards against pathological lines (minified bundles). */
const MAX_HIGHLIGHT_LEN = 4000;

/** Map a filename to one of the language tables above. */
export function languageOf(filename = '') {
  const name = String(filename).toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';

  if (ext === 'py' || ext === 'pyw' || ext === 'pyi') return 'python';
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (ext === 'json' || ext === 'json5') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (['sh', 'bash', 'zsh', 'yaml', 'yml', 'env'].includes(ext)) return 'shell';
  return 'generic';
}

/**
 * Tokenize a single line of source.
 *
 * @param {string} line raw source line
 * @param {string} lang result of `languageOf`
 * @returns {Array<{t: string, c: string | null}>} tokens (`c` = design class)
 */
export function tokenizeLine(line, lang = 'generic') {
  const text = line == null ? '' : String(line);
  const n = text.length;
  if (n === 0) return [];
  if (n > MAX_HIGHLIGHT_LEN) return [{ t: text, c: null }];

  const keywords = KEYWORDS[lang] || KEYWORDS.generic;
  const constants = CONSTANTS[lang] || CONSTANTS.generic;
  const lineComments = LINE_COMMENTS[lang] || [];
  const block = BLOCK_COMMENTS[lang] || null;
  const quotes = STRING_QUOTES[lang] || [];

  const out = [];
  const push = (value, cls) => {
    if (!value) return;
    if (!cls) {
      const last = out[out.length - 1];
      if (last && !last.c) {
        last.t += value;
        return;
      }
    }
    out.push({ t: value, c: cls || null });
  };

  let i = 0;

  while (i < n) {
    const ch = text[i];

    // ---- line comment: rest of the line ----
    let consumed = false;
    for (const marker of lineComments) {
      if (text.startsWith(marker, i)) {
        push(text.slice(i), 'comment');
        i = n;
        consumed = true;
        break;
      }
    }
    if (consumed) break;

    // ---- block comment (only this line — nesting across lines is skipped) ----
    if (block && text.startsWith(block[0], i)) {
      const close = text.indexOf(block[1], i + block[0].length);
      const end = close === -1 ? n : close + block[1].length;
      push(text.slice(i, end), 'comment');
      i = end;
      continue;
    }

    // ---- string literal ----
    if (quotes.includes(ch)) {
      const start = i;
      i += 1;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      push(text.slice(start, Math.min(i, n)), 'str');
      continue;
    }

    // ---- JSON keys ----
    if (lang === 'json' && ch === '"') {
      const match = JSON_KEY_RE.exec(text.slice(i));
      if (match) {
        push(match[0], 'str');
        i += match[0].length;
        continue;
      }
    }

    // ---- number ----
    if (ch >= '0' && ch <= '9') {
      const match = NUMBER_RE.exec(text.slice(i));
      const len = match ? match[0].length : 1;
      push(text.slice(i, i + len), 'num');
      i += len;
      continue;
    }

    // ---- identifier / keyword / constant ----
    if (IDENT_START.test(ch)) {
      const match = IDENT_RE.exec(text.slice(i));
      const word = match[0];
      let cls = 'fn';
      if (keywords.has(word)) cls = 'kw';
      else if (constants.indexOf(word) !== -1) cls = 'const';
      push(word, cls);
      i += word.length;
      continue;
    }

    // ---- operator / punctuation run ----
    const opMatch = OP_RE.exec(text.slice(i));
    if (opMatch) {
      push(opMatch[0], 'op');
      i += opMatch[0].length;
      continue;
    }

    // ---- anything else (whitespace, unicode, …) ----
    push(ch, null);
    i += 1;
  }

  return out;
}
