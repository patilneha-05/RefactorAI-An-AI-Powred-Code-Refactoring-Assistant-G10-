import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';

/**
 * Redirect target for the Google OAuth popup.
 *
 * In the popup, `maybeCompleteGoogleRedirect()` (called during app boot in
 * main.jsx) forwards the credential to the opener and closes the window, so
 * this component is only really seen if someone opens the URL directly.
 */
export default function GoogleOAuthCallback() {
  useEffect(() => {
    // If we somehow render inside the popup without being closed, try again.
    if (window.opener && !window.opener.closed) {
      window.close();
    }
  }, []);

  return (
    <AuthLayout
      title="Completing sign-in"
      subtitle="You can close this window if it doesn't close automatically."
      footer={
        <p className="auth__switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      }
    >
      <p className="auth__note">Finishing Google authentication…</p>
    </AuthLayout>
  );
}
