import { API_BASE_URL } from '../../services/apiClient';
import { useApiStatus } from '../../context/ApiStatusContext';

const LABELS = {
  online: 'API connected',
  offline: 'API offline',
  checking: 'Checking API…',
};

/**
 * Backend connection indicator. Renders a button (opens Settings) when
 * `onActivate` is provided, otherwise a static status element.
 */
export default function StatusPill({ onActivate = null, withUrl = false }) {
  const { status, lastChecked } = useApiStatus();
  const label = LABELS[status] || LABELS.checking;
  const title = [
    `Backend: ${API_BASE_URL}`,
    lastChecked ? `Last checked ${new Date(lastChecked).toLocaleTimeString()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const inner = (
    <>
      <span className="status-pill__dot" aria-hidden="true" />
      <span className="status-pill__text">{label}</span>
      {withUrl ? <span className="status-pill__text mono">{API_BASE_URL}</span> : null}
    </>
  );

  if (onActivate) {
    return (
      <button
        type="button"
        className={`status-pill status-pill--${status}`}
        onClick={onActivate}
        title={`${title} — open Settings`}
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      className={`status-pill status-pill--${status}`}
      role="status"
      title={title}
    >
      {inner}
    </span>
  );
}
