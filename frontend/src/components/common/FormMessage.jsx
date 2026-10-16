import { AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * Form-level feedback message. Renders an error or success notice using the
 * design system's `inline-alert` styles. Pass `message = null` to render
 * nothing.
 */
export default function FormMessage({ type = 'error', message, hint }) {
  if (!message) return null;
  const isError = type === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div
      className={`inline-alert ${isError ? 'inline-alert--error' : 'inline-alert--success'}`}
      role={isError ? 'alert' : 'status'}
    >
      <Icon size={15} className="inline-alert__icon" aria-hidden="true" />
      <span>
        {message}
        {hint ? <span className="inline-alert__hint">{hint}</span> : null}
      </span>
    </div>
  );
}
