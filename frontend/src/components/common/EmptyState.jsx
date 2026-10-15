/** Friendly placeholder for missing or empty content. */
export default function EmptyState({ icon: Icon = null, title, description, actions }) {
  return (
    <div className="empty-state">
      {Icon ? (
        <div className="empty-state__icon">
          <Icon size={24} aria-hidden="true" />
        </div>
      ) : null}
      <div className="empty-state__title">{title}</div>
      {description ? <p className="empty-state__description">{description}</p> : null}
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </div>
  );
}
