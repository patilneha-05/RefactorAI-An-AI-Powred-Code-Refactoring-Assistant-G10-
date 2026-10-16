import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  isGoogleConfigured,
  signInWithGoogle,
} from '../../services/googleOAuth';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * Themed "Continue with Google" button.
 *
 * Uses the OAuth popup flow (see services/googleOAuth). When Google OAuth is
 * not configured the button reports a clear setup message instead of faking a
 * login. The credential (ID token) is handed to `onCredential`, which sends it
 * to the backend for verification — no Google client secret is used client-side.
 */
export default function GoogleSignInButton({
  label = 'Continue with Google',
  onCredential,
  onError,
  disabled = false,
}) {
  const [busy, setBusy] = useState(false);
  const configured = isGoogleConfigured();

  const handleClick = async () => {
    if (busy || disabled) return;
    if (!configured) {
      onError?.(
        'Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in frontend/.env and add the app’s authorized redirect URI in the Google Cloud console.',
      );
      return;
    }
    setBusy(true);
    try {
      const idToken = await signInWithGoogle();
      await onCredential?.(idToken);
    } catch (error) {
      const message = error?.message || 'Google sign-in failed. Please try again.';
      // Cancellation is expected — surface it gently rather than as a failure.
      if (error?.code === 'cancelled') {
        onError?.(null);
      } else {
        onError?.(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn--secondary btn--block google-btn"
      onClick={handleClick}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      title={configured ? undefined : 'Google OAuth is not configured'}
    >
      {busy ? (
        <Loader2 size={16} className="btn-spinner" aria-hidden="true" />
      ) : (
        <GoogleMark />
      )}
      {busy ? 'Opening Google…' : label}
    </button>
  );
}
