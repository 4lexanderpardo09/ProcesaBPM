/** What both processes inject (`AppConfig`). */
export const APP_CONFIG = Symbol('APP_CONFIG');
/** The API's own settings (`ApiConfig`): port, token key, trusted proxies, platform login. Not available in the worker. */
export const API_CONFIG = Symbol('API_CONFIG');
