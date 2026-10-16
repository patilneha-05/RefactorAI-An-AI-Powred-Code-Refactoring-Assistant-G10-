import { Loader2 } from 'lucide-react';

/**
 * Button that reuses the design system's `.btn` classes and adds a loading
 * state. While `loading` the button is disabled so a double submit cannot
 * fire a second request.
 */
export default function Button({
  variant = 'primary',
  size = '',
  block = false,
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'btn',
    variant ? `btn--${variant}` : '',
    size ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
