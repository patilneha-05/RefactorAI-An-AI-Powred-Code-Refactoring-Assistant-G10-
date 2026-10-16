import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as authService from '../services/authService';
import { onSessionExpired, setAccessToken } from '../services/apiClient';
import { ApiError } from '../services/apiClient';

const AuthContext = createContext(null);

/**
 * Global authentication state.
 *
 * status: 'loading' (session being restored) | 'authenticated' | 'anonymous'
 *
 * The backend is the source of truth — the presence of a user object is never
 * treated as proof of a valid session. On mount we ask GET /auth/me; the API
 * client silently refreshes via the HttpOnly cookie when needed. The short-lived
 * access token lives only in memory, so a page reload always re-validates.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const initRef = useRef(false);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  /** Restore the session after a reload / deep link. */
  const restore = useCallback(async () => {
    try {
      const data = await authService.fetchCurrentUser();
      setUser(data?.user ?? null);
      setStatus(data?.user ? 'authenticated' : 'anonymous');
    } catch (error) {
      // 401 after a failed silent refresh simply means "not signed in".
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
      } else {
        // Network/server failure: treat as anonymous but keep the reason
        // out of the UI — the login page will surface connectivity errors
        // when the user actually tries to authenticate.
        setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      }
    }
  }, [clearSession]);

  // Run session restore exactly once (React StrictMode double-invokes effects).
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    restore();
  }, [restore]);

  // React to a failed silent refresh anywhere in the app.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        setStatus('anonymous');
      }),
    [],
  );

  const login = useCallback(async (credentials) => {
    const data = await authService.login(credentials);
    setUser(data?.user ?? null);
    setStatus(data?.user ? 'authenticated' : 'anonymous');
    return data;
  }, []);

  const signup = useCallback(async (values) => {
    const data = await authService.signup(values);
    setUser(data?.user ?? null);
    setStatus(data?.user ? 'authenticated' : 'anonymous');
    return data;
  }, []);

  const googleAuth = useCallback(async ({ idToken }) => {
    const data = await authService.googleAuth({ idToken });
    setUser(data?.user ?? null);
    setStatus(data?.user ? 'authenticated' : 'anonymous');
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      login,
      signup,
      googleAuth,
      logout,
      restore,
    }),
    [status, user, login, signup, googleAuth, logout, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
