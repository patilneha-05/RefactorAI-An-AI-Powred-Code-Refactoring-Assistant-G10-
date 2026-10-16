import { Route, Routes } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout';
import ProtectedRoute, { PublicOnlyRoute } from '../components/auth/ProtectedRoute';
import Launcher from '../pages/Launcher';
import Projects from '../pages/Projects';
import Workspace from '../pages/Workspace';
import Suggestions from '../pages/Suggestions';
import Settings from '../pages/Settings';
import NotFound from '../pages/NotFound';
import Login from '../pages/auth/Login';
import Signup from '../pages/auth/Signup';
import ForgotPassword from '../pages/auth/ForgotPassword';
import ResetPassword from '../pages/auth/ResetPassword';
import GoogleOAuthCallback from '../pages/auth/GoogleOAuthCallback';

/**
 * Application route table.
 *
 * Public auth screens live behind <PublicOnlyRoute> (signed-in users are sent
 * to the app). Everything else — the launcher, workspace, projects,
 * suggestions and settings — is protected. Backend authorization is the real
 * enforcement; these guards only shape navigation.
 */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Authentication screens (redirect away when already signed in). */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      {/* Google OAuth redirect target (opened in a popup, not protected). */}
      <Route path="/auth/google/callback" element={<GoogleOAuthCallback />} />

      {/* Protected application. */}
      <Route element={<ProtectedRoute />}>
        {/* Dashboard (Launcher) — the only screen without a navigation bar. */}
        <Route path="/" element={<Launcher />} />

        {/* The workspace's own `ws-topbar` (FILE / EDIT / VIEW / WINDOW) is its
            navigation bar, so no separate app nav bar is stacked above it. */}
        <Route path="/workspace" element={<Workspace />} />

        <Route element={<AppLayout />}>
          <Route path="/projects" element={<Projects />} />
          <Route path="/suggestions" element={<Suggestions />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* App-like screens keep the nav bar but fill the viewport themselves. */}
        <Route element={<AppLayout fullBleed />}>
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}
