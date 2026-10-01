import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readRefreshCookie } from './refresh-cookie.js';

const withCookie = (cookie: string | undefined) => ({ headers: { cookie } }) as unknown as Request;

describe('readRefreshCookie', () => {
  it.each([
    ['__Secure-refresh_token=abc', 'abc'],
    ['theme=dark; __Secure-refresh_token=abc; lang=es', 'abc'],
    ['__Secure-refresh_token=abc=def', 'abc=def'],
    ['__Secure-refresh_token=', undefined],
    ['x__Secure-refresh_token=abc', undefined],
    ['refresh_token=abc', undefined],
    ['__Secure-refresh_token=planted; __Secure-refresh_token=abc', undefined],
    ['other=1', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%j → %j', (cookie, expected) => {
    expect(readRefreshCookie(withCookie(cookie))).toBe(expected);
  });
});
