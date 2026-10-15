import { useEffect, useState } from 'react';
import { AlertCircle, FolderOpen, FolderPlus, Search } from 'lucide-react';
import Button from '../common/Button';
import ProjectContextDialog from '../common/ProjectContextDialog';
import { Field, Input, TextArea } from '../common/Input';
import { PathValidationResult } from './PathValidator';
import { useProject } from '../../context/ProjectContext';
import { useToast } from '../../context/ToastContext';
import { openExistingProject, validateProjectPath, detectProjectContext } from '../../services/projectService';
import { errorMessage, errorHint } from '../../utils/errors';
import { summarizeTree } from '../../utils/format';

function ServerPathNotice() {
  return (
    <div className="callout callout--info">
      <span className="callout__icon" aria-hidden="true">
        <AlertCircle size={15} />
      </span>
      <span>
        <strong>Nothing is uploaded.</strong> RefactorAI reads files directly from a folder
        on the machine running the backend — use a path that is accessible there
        (absolute, or relative to the backend process).
      </span>
    </div>
  );
}

function ApiErrorAlert({ error }) {
  if (!error) return null;
  const hint = errorHint(error);
  return (
    <div className="inline-alert inline-alert--error" role="alert">
      <AlertCircle size={15} className="inline-alert__icon" aria-hidden="true" />
      <span>
        {errorMessage(error)}
        {hint ? <span className="inline-alert__hint">{hint}</span> : null}
      </span>
    </div>
  );
}

/**
 * Project open/register form.
 *  mode="register" → POST /open_project { is_new: true }
 *  mode="open"     → POST /open_project { is_new: false, project_id }
 */
export default function OpenProjectForm({ mode = 'register', pathSeed = '', onOpened }) {
  const { registerNew, openExisting } = useProject();
  const toast = useToast();

  const [projectName, setProjectName] = useState('');
  const [folderPath, setFolderPath] = useState(pathSeed || '');
  const [projectId, setProjectId] = useState('');
  const [contextText, setContextText] = useState('{}');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [validateError, setValidateError] = useState(null);

  const [lastOpened, setLastOpened] = useState(null);

  // Context builder — opened after the register form passes validation.
  const [contextOpen, setContextOpen] = useState(false);
  const [contextDraft, setContextDraft] = useState({ name: '', path: '' });
  const [contextBase, setContextBase] = useState({});
  const [contextAutoDetected, setContextAutoDetected] = useState(false);
  const [contextError, setContextError] = useState(null);

  useEffect(() => {
    if (pathSeed) {
      setFolderPath(pathSeed);
      setValidation(null);
    }
  }, [pathSeed]);

  const isRegister = mode === 'register';

  const runValidate = async (targetPath = folderPath) => {
    const trimmed = targetPath.trim();
    if (!trimmed) {
      setValidateError('Enter a folder path first.');
      setValidation(null);
      return null;
    }
    setValidating(true);
    setValidateError(null);
    setValidation(null);
    try {
      const result = await validateProjectPath(trimmed);
      setValidation(result);
      return result;
    } catch (error) {
      setValidateError(errorMessage(error));
      return null;
    } finally {
      setValidating(false);
    }
  };

  const finishOpen = (project, verb) => {
    setLastOpened(project);
    setSubmitError(null);
    const summary = summarizeTree(project.tree);
    toast.success(
      `${verb} ${project.project_name}`,
      `${summary.files} files · ${summary.folders} folders indexed`,
    );
    onOpened?.(project);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitError(null);
    setLastOpened(null);

    const errors = {};
    const trimmedPath = folderPath.trim();
    if (isRegister && !projectName.trim()) errors.projectName = 'Project name is required.';
    if (!trimmedPath) {
      errors.folderPath = isRegister
        ? 'Folder path is required to register a project.'
        : 'Enter a folder path to validate it, or paste a project ID below.';
    }

    let projectContext = {};
    if (isRegister && showAdvanced && contextText.trim()) {
      try {
        const parsed = JSON.parse(contextText);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          errors.contextText = 'Project context must be a JSON object.';
        } else {
          projectContext = parsed;
        }
      } catch {
        errors.contextText = 'Project context must be valid JSON.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    if (isRegister) {
      // Validation passed — detect the folder's context, then let the user
      // confirm it. Any explicit JSON context from "advanced" always wins.
      setSubmitting(true);
      let detected = {};
      try {
        const result = await detectProjectContext(trimmedPath);
        if (result?.project_context && typeof result.project_context === 'object') {
          detected = result.project_context;
        }
      } catch {
        detected = {}; // best-effort: the dialog still opens if detection fails
      } finally {
        setSubmitting(false);
      }

      setContextDraft({ name: projectName.trim(), path: trimmedPath });
      setContextBase({ ...detected, ...projectContext });
      setContextAutoDetected(Object.keys(detected).length > 0);
      setContextError(null);
      setContextOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const trimmedId = projectId.trim();
      if (!trimmedId) {
        setFieldErrors({ projectId: 'Project ID is required to open an existing project.' });
        setSubmitting(false);
        return;
      }
      const project = await openExisting(trimmedId);
      finishOpen(project, 'Opened');
    } catch (error) {
      setSubmitError(error);
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  /** "Next" in the context builder: register the project, then report success. */
  const createRegistered = async ({ name, path, context }) => {
    setSubmitting(true);
    setContextError(null);
    try {
      const project = await registerNew({
        projectName: name,
        folderPath: path,
        projectContext: context,
      });
      setContextOpen(false);
      setContextDraft({ name: '', path: '' });
      setContextBase({});
      setContextAutoDetected(false);
      finishOpen(project, project.new_project ? 'Registered' : 'Opened (already registered)');
    } catch (error) {
      setContextError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const openValidated = async (result) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const project = await openExistingProject(result.project_id);
      finishOpen(project, 'Opened');
    } catch (error) {
      setSubmitError(error);
      toast.error(errorMessage(error), errorHint(error) || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const registerValidated = () => {
    setFolderPath(validation?.project_path || folderPath);
    setShowAdvanced(true);
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="panel__title">
          {isRegister ? <FolderPlus size={16} /> : <FolderOpen size={16} />}
          {isRegister ? 'Register a new project' : 'Open an existing project'}
        </span>
      </div>

      <div className="panel__body">
        <form onSubmit={submit} className="form-grid">
          <ServerPathNotice />

          {isRegister ? (
            <Field
              label="Project name"
              error={fieldErrors.projectName}
              hint="Shown in the UI and stored in the backend database."
            >
              <Input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="My Awesome Project"
                invalid={Boolean(fieldErrors.projectName)}
                disabled={submitting}
              />
            </Field>
          ) : null}

          <Field
            label={isRegister ? 'Folder path' : 'Folder path (for validation)'}
            error={fieldErrors.folderPath}
            hint={
              isRegister
                ? 'Absolute path to the project root on the backend machine.'
                : 'Optional — validate the path to look up the project ID automatically.'
            }
          >
            <div className="input-group">
              <Input
                mono
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="/absolute/path/to/project"
                invalid={Boolean(fieldErrors.folderPath)}
                disabled={submitting}
              />
              <Button
                variant="secondary"
                icon={Search}
                onClick={() => runValidate()}
                loading={validating}
                disabled={submitting}
              >
                Validate
              </Button>
            </div>
          </Field>

          {validateError ? (
            <div className="inline-alert inline-alert--error" role="alert">
              <AlertCircle size={15} className="inline-alert__icon" aria-hidden="true" />
              <span>{validateError}</span>
            </div>
          ) : null}

          <PathValidationResult
            result={validation}
            onRegister={registerValidated}
            onOpen={openValidated}
          />

          {isRegister ? (
            <div className="stack-sm">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
                onClick={() => setShowAdvanced((value) => !value)}
                aria-expanded={showAdvanced}
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced: project context (JSON)
              </button>
              {showAdvanced ? (
                <Field
                  label="Project context"
                  optional
                  error={fieldErrors.contextText}
                  hint="Arbitrary JSON metadata stored with the project and sent to agents (empty object is fine)."
                >
                  <TextArea
                    code
                    rows={6}
                    value={contextText}
                    onChange={(event) => setContextText(event.target.value)}
                    invalid={Boolean(fieldErrors.contextText)}
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
              ) : null}
            </div>
          ) : (
            <Field
              label="Project ID"
              error={fieldErrors.projectId}
              hint="Required to open an existing project — paste it directly, or use Validate above to look one up from its path."
            >
              <Input
                mono
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                placeholder="sha256 project id from the backend database"
                invalid={Boolean(fieldErrors.projectId)}
                disabled={submitting}
              />
            </Field>
          )}

          <ApiErrorAlert error={submitError} />

          {lastOpened ? (
            <div className="inline-alert inline-alert--success" role="status">
              <span>
                <strong>{lastOpened.project_name}</strong> is now the active project.
              </span>
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            icon={isRegister ? FolderPlus : FolderOpen}
          >
            {isRegister ? 'Register project' : 'Open project'}
          </Button>
        </form>
      </div>

      {contextOpen ? (
        <ProjectContextDialog
          open
          project={contextDraft}
          baseContext={contextBase}
          autoDetected={contextAutoDetected}
          serverError={contextError}
          loading={submitting}
          onContinue={createRegistered}
          onClose={() => {
            if (submitting) return;
            setContextOpen(false);
            setContextError(null);
          }}
        />
      ) : null}
    </div>
  );
}
