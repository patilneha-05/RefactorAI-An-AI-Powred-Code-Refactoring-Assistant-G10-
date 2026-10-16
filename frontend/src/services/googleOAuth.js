/**
 * Google sign-in (OAuth 2.0 implicit flow for an ID token).
 *
 * The backend owns the Google *client secret* — none is ever shipped to the
 * browser. This module only uses the public `VITE_GOOGLE_CLIENT_ID` to send
 * the user to Google, and returns the resulting `id_token` (a signed JWT) to
 * the caller, which forwards it to `POST /auth/google` for server-side
 * verification against Google's public keys.
 *
 * Flow (popup):
 *   1. Build an authorization URL with a random `state` + `nonce`.
 *   2. Open it in a popup. Google redirects back to our origin with
 *      `#id_token=…&state=…` (registered as a redirect URI).
 *   3. `maybeCompleteGoogleRedirect()` (run on app boot) forwards the token to
 *      the opener via postMessage and closes the popup.
 *   4. The opener validates `state` (CSRF protection) before returning the
 *      token.
 *
 * Cancellation / errors: if the popup is closed without a token we reject with
 * code `cancelled`; Google `error` responses are forwarded as `oauth_error`.
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export function googleClientId() {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

export function isGoogleConfigured() {
  return Boolean(googleClientId());
}

function redirectUri() {
  // Must be registered as an authorized redirect URI in the Google console.
  const base = window.location.origin;
  return `${base}/auth/google/callback`;
}

function randomString(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildAuthUrl(state, nonce) {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

const MESSAGE_SOURCE = 'refactorai-google-oauth';

/**
 * Run once when the app boots. If this document was loaded as the OAuth
 * redirect target (hash contains an ID token or an error) hand it back to the
 * popup opener and close the window.
 *
 * Returns true when the page was acting as the popup redirect target (so the
 * caller can skip rendering the full app).
 */
export function maybeCompleteGoogleRedirect() {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash ? window.location.hash.slice(1) : '';
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const idToken = params.get('id_token');
  const state = params.get('state');
  const error = params.get('error') || params.get('error_description');
  if (!idToken && !error) return false;

  const payload = {
    source: MESSAGE_SOURCE,
    id_token: idToken || null,
    state: state || null,
    error: error || null,
  };

  const hasOpener = Boolean(window.opener && !window.opener.closed);
  if (hasOpener) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      /* opener may be gone — ignore */
    }
  }

  // Strip the token from the URL so it never lingers in history/referrer.
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
  if (hasOpener) {
    window.close();
    return true;
  }
  return false;
}

/**
 * Start Google sign-in in a popup.
 * Resolves with the raw `id_token` string; rejects with `{ code, message }`.
 */
export function signInWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!isGoogleConfigured()) {
      reject({
        code: 'not_configured',
        message:
          'Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID in frontend/.env and register the redirect URI in the Google Cloud console.',
      });
      return;
    }

    const state = randomString();
    const nonce = randomString();
    const authUrl = buildAuthUrl(state, nonce);

    const width = 520;
    const height = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);

    const popup = window.open(
      authUrl,
      'refactorai-google-oauth',
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      reject({
        code: 'popup_blocked',
        message: 'The sign-in window was blocked. Allow popups for this site and try again.',
      });
      return;
    }

    let settled = false;
    let pollId = null;
    let onMessage = null;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollId) clearInterval(pollId);
      pollId = null;
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore */
      }
      fn(value);
    };

    onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== MESSAGE_SOURCE) return;
      // Validate state to prevent login CSRF.
      if (data.state !== state) {
        finish(reject, {
          code: 'state_mismatch',
          message: 'Sign-in could not be verified. Please try again.',
        });
        return;
      }
      if (data.error) {
        finish(reject, {
          code: 'oauth_error',
          message: `Google sign-in failed: ${data.error}`,
        });
        return;
      }
      if (data.id_token) {
        finish(resolve, data.id_token);
        return;
      }
      finish(reject, {
        code: 'no_token',
        message: 'Google did not return a credential. Please try again.',
      });
    };

    window.addEventListener('message', onMessage);

    // Detect the user closing the popup without finishing (cancellation).
    pollId = setInterval(() => {
      if (popup.closed) {
        finish(reject, {
          code: 'cancelled',
          message: 'Google sign-in was cancelled.',
        });
      }
    }, 400);

    // Safety timeout so a hung popup cannot leave listeners forever.
    setTimeout(() => {
      if (!settled) {
        finish(reject, {
          code: 'timeout',
          message: 'Google sign-in timed out. Please try again.',
        });
      }
    }, 120000);
  });
}
