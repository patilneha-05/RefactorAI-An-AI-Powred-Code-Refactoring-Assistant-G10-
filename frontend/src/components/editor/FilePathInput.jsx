import { useEffect, useState } from 'react';
import { FileSearch } from 'lucide-react';
import Button from '../common/Button';
import { Input } from '../common/Input';

/**
 * Manual file selector: the backend has no folder-upload concept and the
 * filename is resolved relative to the active project root.
 */
export default function FilePathInput({ value, onRead, loading = false, disabled = false }) {
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const submit = (event) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed) onRead(trimmed);
  };

  return (
    <form className="workspace__path-input" onSubmit={submit}>
      <div className="input-group">
        <Input
          mono
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="src/main.py"
          aria-label="File path relative to the project root"
          disabled={disabled}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          icon={FileSearch}
          loading={loading}
          disabled={disabled || !draft.trim()}
        >
          Read
        </Button>
      </div>
      <span className="field__hint" style={{ marginTop: 'var(--space-2)', display: 'block' }}>
        Relative to the project root, e.g. <code>src/app.py</code>.
      </span>
    </form>
  );
}
