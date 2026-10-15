import { apiClient } from './apiClient';

/**
 * The backend exposes no dedicated /health route, but FastAPI always serves
 * GET /openapi.json. A successful fetch proves the backend is reachable AND
 * that CORS allows this frontend origin to read its responses.
 */
export function fetchApiSchema() {
  return apiClient.get('/openapi.json', { timeout: 8000 });
}
