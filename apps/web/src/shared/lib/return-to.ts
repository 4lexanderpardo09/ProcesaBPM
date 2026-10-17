const MAX_LENGTH = 2048;
const CONTROL_OR_SPACE = /[\u0000-\u001F\u007F\s]/;
const PUBLIC_ONLY_PATHS = new Set(['/login', '/forgot-password']);
const FALLBACK = '/';

/**
 * Where to go after signing in: only a path of this same app. Anything else (another origin, `//host`,
 * `/\host`, a scheme, control characters, the login page itself) falls back to the home page, so the
 * parameter cannot be used for an open redirect or a loop.
 */
export function sanitizeReturnTo(raw: string | null | undefined, origin: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH || CONTROL_OR_SPACE.test(raw)) return FALLBACK;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return FALLBACK;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== origin || PUBLIC_ONLY_PATHS.has(url.pathname)) return FALLBACK;
  return `${url.pathname}${url.search}${url.hash}`;
}
