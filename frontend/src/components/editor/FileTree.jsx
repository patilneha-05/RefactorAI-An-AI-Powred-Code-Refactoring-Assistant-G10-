import { ChevronRight, FileCode, Folder } from 'lucide-react';

/**
 * Renders the `tree` returned by /open_project:
 *   { dirName: { fileName: null, subDir: { … } }, file.txt: null }
 * Files are `null`, directories are nested objects. The top two levels are
 * expanded by default; deeper levels can be toggled open.
 */
function Nodes({ tree, parentPath = '', selected, onSelect, depth = 0 }) {
  const entries = Object.entries(tree || {}).sort(([, a], [, b]) => {
    const aIsDir = a !== null && typeof a === 'object';
    const bIsDir = b !== null && typeof b === 'object';
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return 0;
  });

  return entries.map(([name, value]) => {
    const relPath = parentPath ? `${parentPath}/${name}` : name;
    const isDir = value !== null && typeof value === 'object';

    if (isDir) {
      return (
        <details className="file-tree__dir" key={relPath} open={depth < 2 || undefined}>
          <summary>
            <ChevronRight size={13} className="file-tree__chevron" aria-hidden="true" />
            <Folder size={14} className="file-tree__icon" aria-hidden="true" />
            <span className="file-tree__file-name">{name}</span>
          </summary>
          <ul className="file-tree__children">
            <li>
              <Nodes
                tree={value}
                parentPath={relPath}
                selected={selected}
                onSelect={onSelect}
                depth={depth + 1}
              />
            </li>
          </ul>
        </details>
      );
    }

    return (
      <button
        key={relPath}
        type="button"
        className={`file-tree__file${selected === relPath ? ' active' : ''}`}
        onClick={() => onSelect(relPath)}
        title={relPath}
        aria-current={selected === relPath ? 'true' : undefined}
      >
        <FileCode size={13} className="file-tree__icon" aria-hidden="true" />
        <span className="file-tree__file-name">{name}</span>
      </button>
    );
  });
}

export default function FileTree({ tree, selected, onSelect }) {
  if (!tree || Object.keys(tree).length === 0) {
    return (
      <p className="text-muted" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--space-2)' }}>
        No file tree available. Re-open the project to load it, or type a file path above.
      </p>
    );
  }

  return (
    <div className="file-tree">
      <Nodes tree={tree} selected={selected} onSelect={onSelect} />
    </div>
  );
}
