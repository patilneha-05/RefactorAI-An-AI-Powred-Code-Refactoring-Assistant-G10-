import { Spinner } from './Loader';

/**
 * Primary interactive element.
 * variant: primary | secondary | ghost | danger | danger-solid
 * size:    sm | md | lg
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon = null,
  block = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
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
      {loading ? (
        <Spinner size={size === 'sm' ? 13 : 15} />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}
