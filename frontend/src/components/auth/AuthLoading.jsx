import { Loader2 } from 'lucide-react';

/** Full-screen loading state used while the session is being restored. */
export default function AuthLoading({ label = 'Loading…' }) {
  return (
    <div className="auth-loading" role="status" aria-live="polite">
      <Loader2 size={22} className="btn-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
