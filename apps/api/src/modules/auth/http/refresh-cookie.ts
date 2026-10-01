import type { CookieOptions, Request, Response } from 'express';

/** `__Secure-`: browsers only accept it from HTTPS responses with the Secure attribute. */
export const REFRESH_COOKIE_NAME = '__Secure-refresh_token';

/** Only sent to the auth endpoints, never readable from JavaScript, not sent on cross-site POSTs. */
const OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth' };

export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_COOKIE_NAME, token, { ...OPTIONS, expires: expiresAt });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, OPTIONS);
}

/**
 * More than one refresh cookie means another site (e.g. a sibling subdomain) planted one next to
 * ours ("cookie tossing"); none of them is trusted then.
 */
export function readRefreshCookie(request: Request): string | undefined {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${REFRESH_COOKIE_NAME}=`))
    .map((pair) => pair.slice(REFRESH_COOKIE_NAME.length + 1));
  return values.length === 1 && values[0] !== '' ? values[0] : undefined;
}
