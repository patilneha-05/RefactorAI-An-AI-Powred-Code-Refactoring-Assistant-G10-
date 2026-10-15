import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import * as projectService from '../services/projectService';
import { readFile, writeFile } from '../services/fileService';
import { resolveSuggestion as resolveSuggestionApi } from '../services/suggestionService';
import { ApiError } from '../services/apiClient';
import { errorMessage } from '../utils/errors';
import { loadJson, saveJson, removeKey } from '../utils/storage';

const ACTIVE_PROJECT_KEY = 'refactorai.activeProject.v1';
const PROJECT_HISTORY_KEY = 'refactorai.projectHistory.v1';
const SUGGESTIONS_KEY = 'refactorai.suggestions.v2';
// Pre-v2 caches can hold suggestions the backend no longer knows about (for
// example the pre-fix items whose `replace_by` was prose). Each of those fails
// /accept_suggestion with 404 "Suggestion not found", so drop them on upgrade.
const LEGACY_SUGGESTIONS_KEYS = ['refactorai.suggestions.v1'];
const CURRENT_FILE_KEY = 'refactorai.currentFile.v1';

const MAX_HISTORY = 6;
const MAX_SUGGESTIONS = 400;

const ProjectContext = createContext(null);

/**
 * Holds everything that must be shared across pages:
 *  - active project (+ browser-local history of opened projects)
 *  - the currently displayed source file
 *  - suggestions returned by /refactor runs (the backend has no
 *    suggestion-listing endpoint, so results are kept client-side and
 *    synced with /accept_suggestion responses)
 */
export function ProjectProvider({ children }) {
  const [activeProject, setActiveProject] = useState(() => loadJson(ACTIVE_PROJECT_KEY, null));
  const [history, setHistory] = useState(() => loadJson(PROJECT_HISTORY_KEY, []));
  const [suggestions, setSuggestions] = useState(() => {
    LEGACY_SUGGESTIONS_KEYS.forEach((key) => removeKey(key));
    return loadJson(SUGGESTIONS_KEY, []);
  });
  const [currentFile, setCurrentFile] = useState(() => loadJson(CURRENT_FILE_KEY, null));
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(null);

  const activeProjectId = activeProject?.project_id ?? null;

  // ---- persistence ----
  useEffect(() => {
    saveJson(ACTIVE_PROJECT_KEY, activeProject);
  }, [activeProject]);
  useEffect(() => {
    saveJson(PROJECT_HISTORY_KEY, history);
  }, [history]);
  useEffect(() => {
    saveJson(SUGGESTIONS_KEY, suggestions);
  }, [suggestions]);
  useEffect(() => {
    if (currentFile) saveJson(CURRENT_FILE_KEY, currentFile);
    else removeKey(CURRENT_FILE_KEY);
  }, [currentFile]);

  // ---- drop the displayed file when the active project changes ----
  const previousProjectRef = useRef(activeProjectId);
  useEffect(() => {
    if (previousProjectRef.current !== activeProjectId) {
      previousProjectRef.current = activeProjectId;
      setCurrentFile(null);
      setFileError(null);
    }
  }, [activeProjectId]);

  // ---- project actions ----
  const adoptProject = useCallback((response) => {
    const project = {
      project_id: response.project_id,
      project_name: response.project_name,
      project_path: response.project_path,
      new_project: Boolean(response.new_project),
      tree: response.tree || {},
    };
    setActiveProject(project);
    setHistory((prev) => {
      const rest = prev.filter((item) => item.project_id !== project.project_id);
      return [
        {
          project_id: project.project_id,
          project_name: project.project_name,
          project_path: project.project_path,
        },
        ...rest,
      ].slice(0, MAX_HISTORY);
    });
    return project;
  }, []);

  /** Open a project already registered in the central DB. */
  const openExisting = useCallback(async (projectId) => {
    const response = await projectService.openExistingProject(projectId);
    return adoptProject(response);
  }, [adoptProject]);

  /** Register a new project folder (creates the local .airefactor.db). */
  const registerNew = useCallback(
    async ({ projectName, folderPath, projectContext }) => {
      const response = await projectService.registerProject({
        projectName,
        folderPath,
        projectContext,
      });
      return adoptProject(response);
    },
    [adoptProject],
  );

  /** Clear the locally selected project (backend state is left untouched). */
  const clearActiveProject = useCallback(() => {
    setActiveProject(null);
    setCurrentFile(null);
    setFileError(null);
  }, []);

  // ---- file actions ----
  const loadFile = useCallback(
    async (filename) => {
      if (!activeProject) {
        throw new ApiError('No active project. Open a project first.', { code: 'NO_PROJECT' });
      }
      setFileLoading(true);
      setFileError(null);
      try {
        const data = await readFile(filename);
        const file = {
          project_id: data.project_id,
          filename: data.filename,
          total_lines: data.total_lines,
          lines: data.lines,
          ends_with_newline: Boolean(data.ends_with_newline),
        };
        setCurrentFile(file);
        return file;
      } catch (error) {
        setFileError(errorMessage(error));
        throw error;
      } finally {
        setFileLoading(false);
      }
    },
    [activeProject],
  );

  /** Re-read the currently displayed file (e.g. after a change was applied). */
  const refreshFile = useCallback(async () => {
    if (!currentFile) return null;
    try {
      return await loadFile(currentFile.filename);
    } catch {
      return null; // fileError state already carries the message
    }
  }, [currentFile, loadFile]);

  /** Write new text to the currently displayed file, then re-read it. */
  const saveFile = useCallback(
    async (content) => {
      if (!activeProject || !currentFile) {
        throw new ApiError('No file is open to save.', { code: 'NO_FILE' });
      }
      const result = await writeFile({
        projectId: activeProject.project_id,
        filename: currentFile.filename,
        content,
      });
      await loadFile(currentFile.filename);
      return result;
    },
    [activeProject, currentFile, loadFile],
  );

  // ---- suggestions ----
  /** Store the suggestions returned by a /refactor run (deduped by id). */
  const recordRefactorRun = useCallback(({ projectId, filename, agent, model, list }) => {
    const receivedAt = Date.now();
    const enriched = (Array.isArray(list) ? list : [])
      .filter((item) => item && item.suggestion_id)
      .map((item) => ({
        ...item,
        suggestion_state: item.suggestion_state || 'pending',
        filename,
        project_id: projectId,
        agent: agent || '',
        model: model || '',
        receivedAt,
      }));

    setSuggestions((prev) => {
      const byId = new Map();
      for (const item of prev) byId.set(item.suggestion_id, item);
      for (const item of enriched) byId.set(item.suggestion_id, item);
      return [...byId.values()]
        .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0))
        .slice(0, MAX_SUGGESTIONS);
    });
    return enriched.length;
  }, []);

  /**
   * Accept or reject a suggestion via /accept_suggestion.
   * Updates local state from the response (accepted/rejected state and the
   * backend-adjusted `remaining_suggestions` of the batch) and re-reads the
   * source file when it is the one currently displayed.
   */
  const resolveSuggestion = useCallback(
    async ({ suggestion, accept }) => {
      let response;
      try {
        response = await resolveSuggestionApi({
          projectId: suggestion.project_id || activeProjectId,
          filename: suggestion.filename,
          suggestionId: suggestion.suggestion_id,
          batchId: suggestion.batch_id,
          accept,
        });
      } catch (error) {
        // The backend no longer knows this suggestion (e.g. the project DB was
        // flushed or reset). Drop the stale card so it cannot be retried forever.
        if (error?.status === 404) {
          setSuggestions((prev) =>
            prev.filter((item) => item.suggestion_id !== suggestion.suggestion_id),
          );
        }
        throw error;
      }

      const nextState = response.accepted ? 'accepted' : 'rejected';

      setSuggestions((prev) => {
        let next = prev.map((item) =>
          item.suggestion_id === response.suggestion_id
            ? { ...item, suggestion_state: nextState }
            : item,
        );

        const remaining = response.remaining_suggestions || [];
        if (remaining.length > 0) {
          const byId = new Map(next.map((item) => [item.suggestion_id, item]));
          for (const row of remaining) {
            const existing = byId.get(row.suggestion_id) || {};
            const merged = { ...existing };
            for (const [key, value] of Object.entries(row)) {
              if (value !== undefined && value !== null) merged[key] = value;
            }
            merged.filename = merged.filename || suggestion.filename;
            merged.project_id = merged.project_id || suggestion.project_id || activeProjectId;
            merged.receivedAt = merged.receivedAt || Date.now();
            byId.set(row.suggestion_id, merged);
          }
          next = [...byId.values()].sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
        }
        return next.slice(0, MAX_SUGGESTIONS);
      });

      const isDisplayedFile =
        currentFile &&
        currentFile.filename === suggestion.filename &&
        (!suggestion.project_id || currentFile.project_id === suggestion.project_id);

      if (accept && isDisplayedFile) {
        await refreshFile();
      }

      return response;
    },
    [activeProjectId, currentFile, refreshFile],
  );

  /** Remove accepted/rejected suggestions of the active project from the local view. */
  const clearResolvedSuggestions = useCallback(() => {
    let removed = 0;
    setSuggestions((prev) => {
      const kept = prev.filter(
        (item) =>
          item.project_id !== activeProjectId || item.suggestion_state === 'pending',
      );
      removed = prev.length - kept.length;
      return kept;
    });
    return removed;
  }, [activeProjectId]);

  // ---- derived ----
  const activeSuggestions = suggestions.filter(
    (item) => item.project_id === activeProjectId,
  );
  const pendingCount = activeSuggestions.filter(
    (item) => item.suggestion_state === 'pending',
  ).length;

  const value = {
    activeProject,
    activeProjectId,
    projectHistory: history,
    suggestions,
    activeSuggestions,
    pendingCount,
    currentFile,
    fileLoading,
    fileError,
    clearFileError: () => setFileError(null),
    openExisting,
    registerNew,
    clearActiveProject,
    loadFile,
    refreshFile,
    saveFile,
    recordRefactorRun,
    resolveSuggestion,
    clearResolvedSuggestions,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used inside <ProjectProvider>');
  return context;
}
