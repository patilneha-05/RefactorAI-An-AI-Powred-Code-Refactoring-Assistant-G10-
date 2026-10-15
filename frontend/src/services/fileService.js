import { apiClient } from './apiClient';

/**
 * POST /read_file — { filename } where `filename` is relative to the active
 * project's root (e.g. "src/main.py").
 *
 * Response: { project_id, filename, total_lines, lines: { "1": "…", … },
 *             ends_with_newline }
 * The backend resolves the active project from its own state file, so a
 * project must be opened first (POST /open_project).
 */
export function readFile(filename) {
  return apiClient.post('/read_file', { filename });
}

/**
 * POST /write_file — { project_id, filename, content }.
 *
 * Overwrites a file that already exists inside the active project with
 * `content`. `project_id` must match the active project.
 * Response: { project_id, filename, total_lines, bytes_written }
 */
export function writeFile({ projectId, filename, content }) {
  return apiClient.post('/write_file', {
    project_id: projectId,
    filename,
    content,
  });
}
