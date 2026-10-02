import { InvalidCredentialsError, MfaNotImplementedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import type { CredentialsRepository } from '../data/credentials.repository.js';
import type { LoginCandidate } from '../domain/login-candidate.js';
import { LoginService } from './login.service.js';

const active: LoginCandidate = {
  id: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  passwordHash: '$argon2id$stored',
  status: 'ACTIVE',
  mfaEnabled: false,
};

function setup(candidate: LoginCandidate | undefined, passwordMatches: boolean, claimed = true) {
  const tx = {};
  const calls: string[] = [];
  const runner = {
    withAnonymousTransaction: vi.fn((work: (tx: object) => unknown) => work(tx)),
    withUserTransaction: vi.fn((_userId: string, work: (tx: object) => unknown) => work(tx)),
  } as unknown as AuthTransactionRunner;
  const credentials = {
    findLoginCandidate: vi.fn().mockResolvedValue(candidate),
    claimLoginAttempt: vi.fn(() => {
      calls.push('claim');
      return Promise.resolve(claimed);
    }),
    recordPasswordSuccess: vi.fn().mockResolvedValue(undefined),
    listOrganizations: vi.fn().mockResolvedValue([]),
    isPlatformAdmin: vi.fn().mockResolvedValue(false),
  };
  const hasher = {
    verify: vi.fn(() => {
      calls.push('verify');
      return Promise.resolve(passwordMatches);
    }),
  };
  const tokens = { issueSelectionToken: vi.fn().mockResolvedValue({ token: 'selection', expiresIn: 120 }) };
  const service = new LoginService(
    runner,
    credentials as unknown as CredentialsRepository,
    hasher as unknown as PasswordHasher,
    tokens as unknown as JwtTokenService,
  );
  return { service, credentials, hasher, calls };
}

const request = { email: 'jane@example.com', password: 'secret password' };

describe('LoginService', () => {
  it('a correct password returns the organizations and the selection token, and gives the claimed attempt back', async () => {
    const { service, credentials } = setup(active, true);
    await expect(service.login(request)).resolves.toEqual({ organizations: [], selectionToken: 'selection', expiresIn: 120, platformAdmin: false });
    expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), active.id, true);
  });

  it('claims the attempt before the password is verified', async () => {
    const { service, calls } = setup(active, true);
    await service.login(request);
    expect(calls).toEqual(['claim', 'verify']);
  });

  it.each([
    ['a wrong password', active, false, true, active.passwordHash],
    ['an unknown e-mail', undefined, true, false, null],
    ['an account the database refuses (locked, disabled)', active, true, false, null],
  ])('with %s: same error, one claim and one password verification, no success recorded', async (_label, candidate, passwordMatches, claimed, verifiedHash) => {
    const { service, credentials, hasher } = setup(candidate, passwordMatches, claimed);
    await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(credentials.claimLoginAttempt).toHaveBeenCalledTimes(1);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(hasher.verify).toHaveBeenCalledWith(verifiedHash, request.password);
    expect(credentials.recordPasswordSuccess).not.toHaveBeenCalled();
  });

  it('claims against a random id when the e-mail is unknown, so the work is the same', async () => {
    const { service, credentials } = setup(undefined, false, false);
    await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const [, userId] = credentials.claimLoginAttempt.mock.calls[0]! as unknown as [unknown, string];
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(userId).not.toBe(active.id);
  });

  it('tells a platform administrator that they may open a platform session', async () => {
    const { service, credentials } = setup(active, true);
    credentials.isPlatformAdmin.mockResolvedValue(true);
    await expect(service.login(request)).resolves.toMatchObject({ platformAdmin: true });
  });

  it('never asks (and never tells) anything about platform rights when the login fails', async () => {
    const { service, credentials } = setup(undefined, false);
    await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(credentials.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('an MFA account with the right password gets MFA_NOT_IMPLEMENTED and no session', async () => {
    const { service, credentials } = setup({ ...active, mfaEnabled: true }, true);
    await expect(service.login(request)).rejects.toBeInstanceOf(MfaNotImplementedError);
    expect(credentials.listOrganizations).not.toHaveBeenCalled();
  });
});
