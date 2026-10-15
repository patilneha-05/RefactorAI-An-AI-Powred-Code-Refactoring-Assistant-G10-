import { apiClient } from './apiClient';

/**
 * POST /open_project — open an existing project or register a new one.
 *
 * Backend contract (backend/main.py :: OpenProjectRequest):
 *  - is_new = false → `project_id` is required (project must exist in the
 *    central DB); the folder must still exist on disk.
 *  - is_new = true  → `project_name`, `folder_path` required and
 *    `project_context` must not be null (`{}` is accepted).
 *
 * Response: { project_id, project_name, project_path, new_project, tree }
 */
export function openProject({ isNew, projectName, folderPath, projectId, projectContext }) {
  const body = { is_new: Boolean(isNew) };
  if (projectId) body.project_id = projectId;
  if (folderPath) body.folder_path = folderPath;
  if (projectName) body.project_name = projectName;
  if (projectContext !== undefined && projectContext !== null) {
    body.project_context = projectContext;
  }
  return apiClient.post('/open_project', body);
}

/** Open a previously registered project by id (is_new = false). */
export function openExistingProject(projectId) {
  return openProject({ isNew: false, projectId });
}

/**
 * POST /detect_project_context — scan a folder and return a suggested context.
 *
 * Response: { folder_path, exists, project_context }
 *   project_context may contain { technology, description, languages,
 *   frameworks, databases, source_files, folders }.
 * Read-only: the backend never registers the project here.
 */
export function detectProjectContext(folderPath) {
  return apiClient.post('/detect_project_context', { folder_path: folderPath });
}

/** Register a brand-new project folder (is_new = true). */
export function registerProject({ projectName, folderPath, projectContext }) {
  return openProject({
    isNew: true,
    projectName,
    folderPath,
    projectContext: projectContext ?? {},
  });
}

/**
 * POST /validate_project_path — { folder_path }
 * Response: { exists_in_db, path_exists, project_id?, project_name?, project_path? }
 */
export function validateProjectPath(folderPath) {
  return apiClient.post('/validate_project_path', { folder_path: folderPath });
}

/**
 * POST /list_projects — list every project registered in the central DB.
 * Added for the launcher's Recent Projects table (additive backend endpoint).
 * Response: { projects: [{ project_id, project_path, project_name,
 *                         github_url, created_at, updated_at }] }
 */
export function listProjects() {
  return apiClient.post('/list_projects', {});
}

/**
 * POST /delete_project — remove a project registration (never touches files).
 * Response: { deleted: bool, project_id }
 */
export function deleteProject(projectId) {
  return apiClient.post('/delete_project', { project_id: projectId });
}
