import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { POST_ACCEPT_VALIDATOR_KEY, SETTINGS_AGENTS } from '../config/agents';
import { loadJson, saveJson } from '../utils/storage';

const AGENT_SETTINGS_KEY = 'refactorai.agentSettings.v1';

const VALID_KEYS = new Set(SETTINGS_AGENTS.map((agent) => agent.key));
const DEFAULT_ENABLED = SETTINGS_AGENTS.filter((agent) => agent.defaultEnabled).map(
  (agent) => agent.key,
);

const AgentSettingsContext = createContext(null);

/**
 * Which agents are enabled for analysis runs.
 *
 * The backend exposes no settings endpoint (agent_config.json is static), so
 * the selection is persisted in this browser and applied by the frontend when
 * it decides which agents to invoke on POST /refactor. Disabled agents are
 * skipped entirely — never called.
 */
export function AgentSettingsProvider({ children }) {
  const [enabledKeys, setEnabledKeys] = useState(() => {
    const stored = loadJson(AGENT_SETTINGS_KEY, null);
    if (!Array.isArray(stored)) return DEFAULT_ENABLED;
    // Keep only keys that still exist in the registry. The design-only
    // PostAcceptValidator card is not user-toggleable and is always shown on.
    const next = new Set(stored.filter((key) => VALID_KEYS.has(key)));
    next.add(POST_ACCEPT_VALIDATOR_KEY);
    return [...next];
  });

  useEffect(() => {
    saveJson(AGENT_SETTINGS_KEY, enabledKeys);
  }, [enabledKeys]);

  const isEnabled = useCallback((key) => enabledKeys.includes(key), [enabledKeys]);

  const setEnabled = useCallback((key, value) => {
    if (!VALID_KEYS.has(key)) return;
    setEnabledKeys((prev) => {
      const has = prev.includes(key);
      if (value && !has) return [...prev, key];
      if (!value && has) return prev.filter((item) => item !== key);
      return prev;
    });
  }, []);

  const value = useMemo(
    () => ({ enabledKeys, isEnabled, setEnabled }),
    [enabledKeys, isEnabled, setEnabled],
  );

  return (
    <AgentSettingsContext.Provider value={value}>{children}</AgentSettingsContext.Provider>
  );
}

export function useAgentSettings() {
  const context = useContext(AgentSettingsContext);
  if (!context) throw new Error('useAgentSettings must be used inside <AgentSettingsProvider>');
  return context;
}
