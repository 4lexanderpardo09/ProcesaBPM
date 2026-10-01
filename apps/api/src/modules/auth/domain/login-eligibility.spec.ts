import { describe, expect, it } from 'vitest';
import { canAttemptLogin, type LoginCandidate } from './login-eligibility.js';

const now = new Date('2026-10-01T12:00:00Z');
const candidate: LoginCandidate = { id: 'u', passwordHash: 'h', status: 'ACTIVE', lockedUntil: null, mfaEnabled: false };

describe('canAttemptLogin', () => {
  it.each([
    ['an active account', candidate, true],
    ['a lockout still running', { ...candidate, lockedUntil: new Date('2026-10-01T12:00:01Z') }, false],
    ['a lockout that ends now', { ...candidate, lockedUntil: now }, true],
    ['a lockout that ended', { ...candidate, lockedUntil: new Date('2026-10-01T11:00:00Z') }, true],
    ['an account locked by an administrator', { ...candidate, status: 'LOCKED' as const }, false],
    ['a disabled account', { ...candidate, status: 'DISABLED' as const }, false],
  ])('%s: %s', (_label, value, expected) => {
    expect(canAttemptLogin(value, now)).toBe(expected);
  });
});
