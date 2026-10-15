/** Status badge used across suggestion and project views. */
export default function Badge({ tone = 'neutral', mono = false, className = '', children, ...rest }) {
  const classes = ['badge', `badge--${tone}`, mono ? 'badge--mono' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
