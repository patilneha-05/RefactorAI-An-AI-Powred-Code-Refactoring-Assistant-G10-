import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLoading from './AuthLoading';

/**
 * Route guard for authenticated areas.
 *
 * While the session is being restored we render a loading state (never a
 * redirect) to avoid bouncing an authenticated user to /login on a hard
 * refresh. Unauthenticated visitors are sent to /login and the attempted
 * location is preserved so a deep link can be restored after sign-in.
 *
 * NOTE: this is UX only — every protected backend endpoint enforces auth
 * independently, so the guard cannot be relied on for security.
 */
export default function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <AuthLoading label="Restoring your session…" />;
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/** Inverse guard: keep authenticated users away from the auth screens. */
export function PublicOnlyRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <AuthLoading label="Loading…" />;
  }

  if (status === 'authenticated') {
    const from = location.state?.from?.pathname;
    return <Navigate to={from || '/'} replace />;
  }

  return <Outlet />;
}
