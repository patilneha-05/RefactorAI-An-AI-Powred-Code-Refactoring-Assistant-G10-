import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchApiSchema } from '../services/systemService';
import { errorMessage } from '../utils/errors';

const ApiStatusContext = createContext(null);

/**
 * Backend reachability state shared by the topbar pill, dashboard and
 * settings page. Uses GET /openapi.json (always served by FastAPI) as a
 * safe health check — a successful read also proves CORS is configured.
 */
export function ApiStatusProvider({ children }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  const check = useCallback(async () => {
    setIsChecking(true);
    setStatus('checking');
    try {
      const data = await fetchApiSchema();
      setSchema({
        title: data?.info?.title || 'RefactorAI',
        version: data?.info?.version || 'unknown',
        paths: data?.paths ? Object.keys(data.paths) : [],
      });
      setError(null);
      setStatus('online');
    } catch (err) {
      setSchema(null);
      setError(errorMessage(err));
      setStatus('offline');
    } finally {
      setLastChecked(Date.now());
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const value = {
    status,
    schema,
    error,
    lastChecked,
    isChecking,
    check,
    isOnline: status === 'online',
  };

  return <ApiStatusContext.Provider value={value}>{children}</ApiStatusContext.Provider>;
}

export function useApiStatus() {
  const context = useContext(ApiStatusContext);
  if (!context) throw new Error('useApiStatus must be used inside <ApiStatusProvider>');
  return context;
}
