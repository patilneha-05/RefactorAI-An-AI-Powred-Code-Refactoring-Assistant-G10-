import { AlertCircle, Info } from 'lucide-react';
import { useId } from 'react';

/** Labeled form wrapper with hint and validation message. */
export function Field({ label, optional, hint, error, htmlFor, children }) {
  const generatedId = useId();
  const labelId = htmlFor || generatedId;
  return (
    <div className="field">
      {label ? (
        <label className="field__label" htmlFor={labelId}>
          {label}
          {optional ? <span className="field__optional">optional</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? (
        <span className="field__error" role="alert">
          <AlertCircle size={13} aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Input({ invalid = false, mono = false, className = '', ...rest }) {
  const classes = [
    'input',
    invalid ? 'input--invalid' : '',
    mono ? 'input--mono' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <input className={classes} aria-invalid={invalid || undefined} {...rest} />;
}

export function TextArea({ invalid = false, code = false, className = '', ...rest }) {
  const classes = [
    'textarea',
    invalid ? 'input--invalid' : '',
    code ? 'textarea--code' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <textarea className={classes} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className = '', ...rest }) {
  return <select className={`select ${className}`.trim()} {...rest} />;
}

/** Small inline informational note with an icon. */
export function Hint({ icon: Icon = Info, children, className = '' }) {
  return (
    <span className={`field__hint ${className}`.trim()}>
      <Icon size={12} aria-hidden="true" /> {children}
    </span>
  );
}
