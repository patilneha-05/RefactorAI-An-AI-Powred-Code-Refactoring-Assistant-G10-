import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.type] || Info;
  return (
    <div
      className={`toast toast--${toast.type}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <Icon size={17} className="toast__icon" aria-hidden="true" />
      <div className="toast__content">
        <div className="toast__message">{toast.message}</div>
        {toast.detail ? <div className="toast__detail">{toast.detail}</div> : null}
      </div>
      <button
        type="button"
        className="toast__dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Fixed viewport that renders the current toast stack. */
export function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="toast-viewport" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
