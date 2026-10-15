import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Pencil } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { Field, Input, TextArea } from './Input';

/**
 * Suggestions offered by the TECHNOLOGY field. These are only a convenience
 * datalist — any value is accepted; nothing is validated against the backend.
 */
const TECHNOLOGY_SUGGESTIONS = [
  'JavaScript',
  'TypeScript',
  'React',
  'Vue',
  'Angular',
  'Svelte',
  'Node.js',
  'Express',
  'Python',
  'FastAPI',
  'Django',
  'Flask',
  'Java',
  'Spring Boot',
  'Go',
  'Rust',
  'Ruby',
  'Ruby on Rails',
  'PHP',
  'Laravel',
  'C#',
  '.NET',
  'C++',
  'Kotlin',
  'Swift',
  'Dart / Flutter',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Docker',
];

/**
 * Assemble the `project_context` object sent to POST /open_project.
 *
 * The backend stores this dict verbatim and injects it into every agent prompt
 * (see AgentCommunication.py, which documents `{ "project_name", "technology" }`
 * as the canonical shape), so `project_name` is always included and the
 * optional fields are omitted when left blank.
 */
function buildProjectContext({ name, technology, description, baseContext = {} }) {
  const context = { ...baseContext, project_name: (name || '').trim() };
  const tech = (technology || '').trim();
  const desc = (description || '').trim();
  // Empty fields clear the (possibly auto-detected) value rather than keeping it.
  if (tech) context.technology = tech;
  else delete context.technology;
  if (desc) context.description = desc;
  else delete context.description;
  return context;
}

/** Keys shown as their own labelled row; everything else is rendered as a row too. */
const CORE_CONTEXT_KEYS = ['project_name', 'technology', 'description'];

/** Render any context value as display text (strings as-is, everything else JSON). */
function contextValueText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

/** `my_key` / `my-key` → `My key` for the review rows. */
function humanizeKey(key) {
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Context-builder dialog shown while a project is being created.
 *
 * It opens right after the create form is submitted, shows every detail that
 * will be registered, and offers exactly two primary actions:
 *   EDIT → open the inline editor to adjust the name, path and context.
 *   NEXT → hand the assembled values back to the caller, which registers the
 *          project (POST /open_project { is_new: true }) and opens the workspace.
 *
 * Rendered through a portal so ancestor shells (e.g. the launcher's scoped
 * `.modal` rules) cannot restyle it.
 */
export default function ProjectContextDialog({
  open,
  project,
  baseContext = {},
  autoDetected = false,
  serverError = null,
  loading = false,
  onContinue,
  onClose,
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [path, setPath] = useState(project?.path ?? '');
  // Seed from any context already supplied by the caller (e.g. the JSON
  // "advanced" box) so the review step shows the real values instead of "Not set".
  const [technology, setTechnology] = useState(() => contextValueText(baseContext?.technology));
  const [description, setDescription] = useState(() => contextValueText(baseContext?.description));
  const [error, setError] = useState(null);

  if (!open) return null;

  // Everything that will actually be stored with the project and sent to agents.
  const assembledContext = buildProjectContext({ name, technology, description, baseContext });
  const extraContext = Object.entries(assembledContext).filter(
    ([key]) => !CORE_CONTEXT_KEYS.includes(key),
  );
  const hasContext = Boolean(technology.trim() || description.trim() || extraContext.length);

  const handleNext = () => {
    if (loading) return;
    if (!name.trim() || !path.trim()) {
      setEditing(true);
      setError('A project name and a folder path are required before continuing.');
      return;
    }
    setError(null);
    onContinue?.({
      name: name.trim(),
      path: path.trim(),
      context: buildProjectContext({ name, technology, description, baseContext }),
    });
  };

  const startEditing = () => {
    setError(null);
    setEditing(true);
  };

  const stopEditing = () => {
    setError(null);
    setEditing(false);
  };

  const message = error || serverError;

  return createPortal(
    <Modal
      open={open}
      onClose={loading ? undefined : onClose}
      closeDisabled={loading}
      wide
      title="Build project context"
      subtitle="Review the details agents will receive, then continue to the workspace."
      footer={
        <>
          {editing ? (
            <Button
              variant="secondary"
              icon={ArrowLeft}
              onClick={stopEditing}
              disabled={loading}
            >
              Back
            </Button>
          ) : (
            <Button
              variant="secondary"
              icon={Pencil}
              onClick={startEditing}
              disabled={loading}
            >
              Edit
            </Button>
          )}
          <Button
            variant="primary"
            icon={editing ? Check : ArrowRight}
            loading={loading}
            onClick={handleNext}
          >
            Next
          </Button>
        </>
      }
    >
      <div className="pctx">
        <p className="pctx__lead">
          This context is stored with the project and included in every agent prompt.
          Nothing is uploaded — the folder is read directly on the backend machine.
        </p>

        {autoDetected ? (
          <p className="pctx__detected">
            Auto-detected from the project folder. Use <strong>Edit</strong> to
            correct anything before continuing.
          </p>
        ) : null}

        {message ? (
          <div className="pctx__alert" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}

        {editing ? (
          <div className="pctx__form">
            <Field label="Project name">
              <Input
                value={name}
                placeholder="My Awesome Project"
                disabled={loading}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field
              label="Folder path"
              hint="Absolute path to the project root on the machine running the backend."
            >
              <Input
                mono
                value={path}
                placeholder="/absolute/path/to/project"
                disabled={loading}
                onChange={(event) => setPath(event.target.value)}
              />
            </Field>

            <Field
              label="Technology"
              optional
              hint="Primary language, framework or stack. Sent to the agents as-is."
            >
              <Input
                list="pctx-technology-options"
                value={technology}
                placeholder="e.g. React, FastAPI, PostgreSQL"
                disabled={loading}
                onChange={(event) => setTechnology(event.target.value)}
              />
              <datalist id="pctx-technology-options">
                {TECHNOLOGY_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </Field>

            <Field
              label="Description"
              optional
              hint="A sentence or two describing what the project does."
            >
              <TextArea
                rows={3}
                value={description}
                placeholder="Customer complaint management dashboard…"
                disabled={loading}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="pctx__review">
            <section className="pctx-group" aria-label="Project details">
              <h3 className="pctx-group__title">Project details</h3>
              <dl className="pctx-group__list">
                <div className="pctx-row">
                  <dt>Name</dt>
                  <dd>{name || <span className="pctx-empty">Not set</span>}</dd>
                </div>
                <div className="pctx-row">
                  <dt>Folder path</dt>
                  <dd className="pctx-mono">
                    {path || <span className="pctx-empty">Not set</span>}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="pctx-group" aria-label="Project context">
              <h3 className="pctx-group__title">Project context</h3>
              <dl className="pctx-group__list">
                <div className="pctx-row">
                  <dt>Technology</dt>
                  <dd>{technology || <span className="pctx-empty">Not set</span>}</dd>
                </div>
                <div className="pctx-row">
                  <dt>Description</dt>
                  <dd>{description || <span className="pctx-empty">Not set</span>}</dd>
                </div>
                {extraContext.map(([key, value]) => (
                  <div className="pctx-row" key={key}>
                    <dt>{humanizeKey(key)}</dt>
                    <dd>
                      {contextValueText(value) || <span className="pctx-empty">Not set</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              {!hasContext ? (
                <p className="pctx-group__hint">
                  No context yet — choose <strong>Edit</strong> to add technology and a
                  description for the agents.
                </p>
              ) : null}
              <div className="pctx-preview">
                <div className="pctx-preview__head">Context sent to agents</div>
                <pre className="pctx-preview__body">
                  {JSON.stringify(assembledContext, null, 2)}
                </pre>
              </div>
            </section>
          </div>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
