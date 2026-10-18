import { describe, expect, it } from 'vitest';
import { isUrlLoginNotice, loginPath } from './paths';

describe('loginPath', () => {
  it.each([
    [undefined, undefined, '/login'],
    ['/', undefined, '/login'],
    ['/tickets?tab=mine', undefined, '/login?returnTo=%2Ftickets%3Ftab%3Dmine'],
    ['/people', 'expired', '/login?returnTo=%2Fpeople&notice=expired'],
    [undefined, 'signedOutElsewhere', '/login?notice=signedOutElsewhere'],
  ] as const)('returnTo %j and notice %j → %s', (returnTo, notice, expected) => {
    expect(loginPath(returnTo, notice)).toBe(expected);
  });
});

describe('isUrlLoginNotice', () => {
  it('only accepts the known notices', () => {
    expect(isUrlLoginNotice('expired')).toBe(true);
    expect(isUrlLoginNotice('challengeExpired')).toBe(false);
    expect(isUrlLoginNotice('<script>')).toBe(false);
    expect(isUrlLoginNotice(null)).toBe(false);
  });
});
