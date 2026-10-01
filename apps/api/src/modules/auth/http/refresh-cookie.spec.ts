import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readRefreshCookie } from './refresh-cookie.js';

const withCookie = (cookie: string | undefined) => ({ headers: { cookie } }) as unknown as Request;

describe('readRefreshCookie', () => {
  it.each([
    ['refresh_token=abc', 'abc'],
    ['theme=dark; refresh_token=abc; lang=es', 'abc'],
    ['refresh_token=abc=def', 'abc=def'],
    ['refresh_token=', undefined],
    ['xrefresh_token=abc', undefined],
    ['other=1', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%j → %j', (cookie, expected) => {
    expect(readRefreshCookie(withCookie(cookie))).toBe(expected);
  });
});
