import { InvalidCredentialsError, MfaNotImplementedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../infrastructure/clock.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import type { CredentialsRepository } from '../data/credentials.repository.js';
import type { LoginCandidate } from '../domain/login-eligibility.js';
import { LoginService } from './login.service.js';

const now = new Date('2026-10-01T12:00:00Z');
const active: LoginCandidate = {
  id: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  passwordHash: '$argon2id$stored',
  status: 'ACTIVE',
  lockedUntil: null,
  mfaEnabled: false,
};

function setup(candidate: LoginCandidate | undefined, passwordMatches: boolean) {
  const tx = {};
  const runner = {
    withAnonymousTransaction: vi.fn((work: (tx: object) => unknown) => work(tx)),
    withUserTransaction: vi.fn((_userId: string, work: (tx: object) => unknown) => work(tx)),
  } as unknown as AuthTransactionRunner;
  const credentials = {
    findLoginCandidate: vi.fn().mockResolvedValue(candidate),
    registerLoginAttempt: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue([]),
  };
  const hasher = { verify: vi.fn().mockResolvedValue(passwordMatches) };
  const tokens = { issueSelectionToken: vi.fn().mockResolvedValue({ token: 'selection', expiresIn: 120 }) };
  const clock: Clock = { now: () => now };
  const service = new LoginService(
    runner,
    credentials as unknown as CredentialsRepository,
    hasher as unknown as PasswordHasher,
    tokens as unknown as JwtTokenService,
    clock,
  );
  return { service, credentials, hasher };
}

const request = { email: 'jane@example.com', password: 'secret password' };

describe('LoginService', () => {
  it('a correct password returns the organizations and the selection token, and resets the counter', async () => {
    const { service, credentials } = setup(active, true);
    await expect(service.login(request)).resolves.toEqual({ organizations: [], selectionToken: 'selection', expiresIn: 120 });
    expect(credentials.registerLoginAttempt).toHaveBeenCalledWith(expect.anything(), active.id, true);
  });

  it.each([
    ['a wrong password', active, false, active.passwordHash, active.id],
    ['an unknown e-mail', undefined, true, null, undefined],
    ['a running lockout', { ...active, lockedUntil: new Date('2026-10-01T12:05:00Z') }, true, null, undefined],
    ['an account locked by an administrator', { ...active, status: 'LOCKED' as const }, true, null, undefined],
    ['a disabled account', { ...active, status: 'DISABLED' as const }, true, null, undefined],
  ])(
    'with %s: same error, one password verification and one attempt update',
    async (_label, candidate, passwordMatches, verifiedHash, countedUser) => {
      const { service, credentials, hasher } = setup(candidate, passwordMatches);
      await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(hasher.verify).toHaveBeenCalledTimes(1);
      expect(hasher.verify).toHaveBeenCalledWith(verifiedHash, request.password);
      expect(credentials.registerLoginAttempt).toHaveBeenCalledTimes(1);
      const [, userId, success] = credentials.registerLoginAttempt.mock.calls[0]!;
      expect(success).toBe(false);
      // Real failures count against the account; the others update a random id that matches no row.
      if (countedUser === undefined) expect(userId).not.toBe(active.id);
      else expect(userId).toBe(countedUser);
    },
  );

  it('an MFA account with the right password gets MFA_NOT_IMPLEMENTED and no session', async () => {
    const { service, credentials } = setup({ ...active, mfaEnabled: true }, true);
    await expect(service.login(request)).rejects.toBeInstanceOf(MfaNotImplementedError);
    expect(credentials.listOrganizations).not.toHaveBeenCalled();
  });
});
