/** Indeterminate circular spinner. */
export function Spinner({ size = 16, className = '' }) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Block loading indicator with an accessible status label. */
export default function Loader({ label = 'Loading…', size = 22 }) {
  return (
    <div className="loader-block" role="status">
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );
}

/** Compact inline loading indicator for panels and headers. */
export function InlineLoader({ label = 'Loading…' }) {
  return (
    <span className="loader-inline" role="status">
      <Spinner size={14} />
      <span>{label}</span>
    </span>
  );
}
