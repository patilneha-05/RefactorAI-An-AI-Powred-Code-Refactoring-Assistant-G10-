/**
 * Shared shell for the authentication screens: a centered card on the dark
 * IDE backdrop with RefactorAI branding, a mono heading block, and the form
 * slot. Keeps every auth page visually identical to the rest of the app.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <span className="auth__logo" aria-hidden="true">
            {'</>'}
          </span>
          <span className="auth__brand-name">RefactorAI</span>
        </div>

        <header className="auth__header">
          <h1 className="auth__title">{title}</h1>
          {subtitle ? <p className="auth__subtitle">{subtitle}</p> : null}
        </header>

        <div className="auth__body">{children}</div>

        {footer ? <div className="auth__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
