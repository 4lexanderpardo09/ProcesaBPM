/**
 * Every HTTP route of the API lives under this prefix (`/api/auth/login`, `/api/health`…), so the web app and the API
 * can share one origin: the reverse proxy sends `/api/*` to the API and everything else to the web app.
 */
export const API_PREFIX = '/api';

/** Where the refresh cookie is sent: only to the auth endpoints. */
export const AUTH_COOKIE_PATH = `${API_PREFIX}/auth`;
