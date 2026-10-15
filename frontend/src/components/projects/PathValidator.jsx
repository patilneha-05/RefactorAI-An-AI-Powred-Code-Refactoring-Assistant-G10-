import { useState } from 'react';
import { AlertCircle, CheckCircle2, FolderCheck, FolderX, Search } from 'lucide-react';
import Button from '../common/Button';
import { Input } from '../common/Input';
import { validateProjectPath } from '../../services/projectService';
import { errorMessage } from '../../utils/errors';
import { shortId } from '../../utils/format';

/** Renders the outcome of /validate_project_path. */
export function PathValidationResult({ result, onRegister, onOpen }) {
  if (!result) return null;

  if (result.exists_in_db) {
    return (
      <div className="validation-result validation-result--registered">
        <div className="validation-result__status">
          <CheckCircle2 size={16} color="var(--accent)" aria-hidden="true" />
          Registered project found
        </div>
        <div className="validation-result__meta">
          <span>{result.project_name}</span>
          <span>ID: {shortId(result.project_id, 14)}</span>
          <span>{result.project_path}</span>
        </div>
        {onOpen ? (
          <div className="validation-result__actions">
            <Button size="sm" variant="primary" onClick={() => onOpen(result)}>
              Open this project
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (result.path_exists) {
    return (
      <div className="validation-result">
        <div className="validation-result__status">
          <FolderCheck size={16} color="var(--info)" aria-hidden="true" />
          Folder exists on the server, but is not registered yet
        </div>
        {onRegister ? (
          <div className="validation-result__actions">
            <Button size="sm" variant="primary" onClick={() => onRegister(result)}>
              Register this project
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="validation-result validation-result--missing">
      <div className="validation-result__status">
        <FolderX size={16} color="var(--danger)" aria-hidden="true" />
        No folder found at this path on the server machine
      </div>
      <div className="validation-result__meta">
        <span>Check the spelling and make sure the folder is accessible to the backend.</span>
      </div>
    </div>
  );
}

/** Standalone /validate_project_path tool. */
export default function PathValidator({ onRegister, onOpen }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const validate = async (event) => {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Enter a folder path first.');
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await validateProjectPath(trimmed));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="panel__title">
          <Search size={16} aria-hidden="true" />
          Validate a folder path
        </span>
      </div>
      <div className="panel__body stack">
        <form onSubmit={validate} className="stack-sm">
          <Input
            mono
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/project"
            aria-label="Project folder path"
            invalid={Boolean(error)}
          />
          <Button type="submit" variant="secondary" loading={busy} icon={Search} block>
            Validate path
          </Button>
        </form>

        {error ? (
          <div className="inline-alert inline-alert--error" role="alert">
            <AlertCircle size={15} className="inline-alert__icon" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <PathValidationResult
          result={result}
          onRegister={onRegister ? () => onRegister(path.trim()) : undefined}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}
