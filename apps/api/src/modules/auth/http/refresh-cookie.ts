import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'refresh_token';

/** Only sent to the auth endpoints, never readable from JavaScript, not sent on cross-site POSTs. */
const OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth' };

export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_COOKIE_NAME, token, { ...OPTIONS, expires: expiresAt });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, OPTIONS);
}

export function readRefreshCookie(request: Request): string | undefined {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return value === '' ? undefined : value;
  }
  return undefined;
}
