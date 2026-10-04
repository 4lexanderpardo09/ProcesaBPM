import { InvalidCredentialsError, MaintenanceError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundTasks } from '../../../common/background/background-tasks.js';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { SelectionIssuer } from './selection-issuer.js';
import type { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import type { CredentialsRepository } from '../data/credentials.repository.js';
import type { AttemptClaim } from '../domain/attempt-claim.js';
import type { LoginCandidate } from '../domain/login-candidate.js';
import type { SecurityNotifier } from './security-notifier.js';
import type { SignInGate } from './sign-in-gate.js';
import { LoginService } from './login.service.js';

const active: LoginCandidate = {
  id: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  passwordHash: '$argon2id$stored',
  status: 'ACTIVE',
  mfaEnabled: false,
};
const SELECTION = { step: 'SELECT_ORGANIZATION', organizations: [], selectionToken: 'selection', expiresIn: 120, platformAdmin: false } as const;

function setup(candidate: LoginCandidate | undefined, passwordMatches: boolean, claimed = true, locking = false) {
  const claim: AttemptClaim = { claimed, locking: claimed && locking };
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
      return Promise.resolve(claim);
    }),
    recordPasswordSuccess: vi.fn().mockResolvedValue(undefined),
    isPlatformAdmin: vi.fn().mockResolvedValue(false),
    requiresMfaByMembership: vi.fn().mockResolvedValue(false),
  };
  const hasher = {
    verify: vi.fn(() => {
      calls.push('verify');
      return Promise.resolve(passwordMatches);
    }),
  };
  const tokens = { issueMfaChallenge: vi.fn().mockResolvedValue({ token: 'challenge', expiresIn: 300 }) };
  const selection = { issue: vi.fn().mockResolvedValue(SELECTION) };
  const notifier = { notifyLockout: vi.fn().mockResolvedValue(undefined) };
  const background = new BackgroundTasks({ error: vi.fn() } as unknown as JsonLogger);
  const gate = { refusalFor: vi.fn().mockResolvedValue(undefined) };
  const service = new LoginService(
    runner,
    credentials as unknown as CredentialsRepository,
    hasher as unknown as PasswordHasher,
    tokens as unknown as JwtTokenService,
    selection as unknown as SelectionIssuer,
    notifier as unknown as SecurityNotifier,
    background,
    gate as unknown as SignInGate,
  );
  return { service, background, credentials, hasher, calls, tokens, selection, notifier, gate };
}

const request = { email: 'jane@example.com', password: 'secret password' };

describe('LoginService', () => {
  it('a correct password returns the organizations and the selection token, and gives the claimed attempt back', async () => {
    const { service, credentials, selection } = setup(active, true);
    await expect(service.login(request)).resolves.toEqual(SELECTION);
    expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), active.id, true);
    expect(selection.issue).toHaveBeenCalledWith(active.id, false);
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

  it('tells nobody about platform rights or maintenance when the login fails', async () => {
    const { service, credentials, gate } = setup(undefined, false);
    await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(credentials.isPlatformAdmin).not.toHaveBeenCalled();
    expect(gate.refusalFor).not.toHaveBeenCalled();
  });

  describe('during a maintenance block for every organization', () => {
    const refusal = new MaintenanceError({ announcementId: 'a1', title: 'Window', body: 'x', endsAt: null }, undefined);

    it.each([
      ['without MFA', active],
      ['with MFA (refused before the second factor)', { ...active, mfaEnabled: true }],
    ])('refuses a right password %s, gives the attempt back without stamping the sign-in, and issues nothing', async (_label, candidate) => {
      const { service, credentials, gate, selection, tokens } = setup(candidate, true);
      gate.refusalFor.mockResolvedValue(refusal);
      await expect(service.login(request)).rejects.toBe(refusal);
      expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), active.id, false);
      expect(selection.issue).not.toHaveBeenCalled();
      expect(tokens.issueMfaChallenge).not.toHaveBeenCalled();
    });

    it('tells the gate whether the account administers the platform, so it needs no second lookup', async () => {
      const { service, credentials, gate } = setup({ ...active, mfaEnabled: true }, true);
      credentials.isPlatformAdmin.mockResolvedValue(true);
      await service.login(request);
      expect(gate.refusalFor).toHaveBeenCalledWith(active.id, true);
    });
  });

  describe('the lockout notice', () => {
    it('is queued once when the attempt that locks the account has a wrong password', async () => {
      const { service, notifier, background } = setup(active, false, true, true);
      await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
      await background.whenIdle();
      expect(notifier.notifyLockout).toHaveBeenCalledTimes(1);
      expect(notifier.notifyLockout).toHaveBeenCalledWith(active.id, 'ACCOUNT_LOCKED');
    });

    it('is not queued when the locking attempt has the right password (the lock is given back)', async () => {
      const { service, notifier } = setup(active, true, true, true);
      await expect(service.login(request)).resolves.toEqual(SELECTION);
      expect(notifier.notifyLockout).not.toHaveBeenCalled();
    });

    it.each([
      ['a wrong password before the maximum', active, true, false],
      ['an unknown e-mail', undefined, false, false],
      ['an account already locked', active, false, false],
    ])('is not queued for %s', async (_label, candidate, claimed, locking) => {
      const { service, notifier } = setup(candidate, false, claimed, locking);
      await expect(service.login(request)).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(notifier.notifyLockout).not.toHaveBeenCalled();
    });
  });

  describe('after the right password', () => {
    it('an account with MFA gets a verification challenge and no selection token; the sign-in is not complete', async () => {
      const { service, credentials, tokens, selection } = setup({ ...active, mfaEnabled: true }, true);
      await expect(service.login(request)).resolves.toEqual({ step: 'MFA_REQUIRED', challengeToken: 'challenge', expiresIn: 300, methods: ['TOTP', 'BACKUP_CODE'] });
      expect(tokens.issueMfaChallenge).toHaveBeenCalledWith(active.id, 'VERIFY');
      expect(selection.issue).not.toHaveBeenCalled();
      expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), active.id, false);
    });

    it('a platform administrator without MFA must enroll first', async () => {
      const { service, credentials, tokens } = setup(active, true);
      credentials.isPlatformAdmin.mockResolvedValue(true);
      await expect(service.login(request)).resolves.toEqual({ step: 'MFA_ENROLLMENT_REQUIRED', challengeToken: 'challenge', expiresIn: 300, reason: 'PLATFORM_ADMIN' });
      expect(tokens.issueMfaChallenge).toHaveBeenCalledWith(active.id, 'ENROLL');
    });

    it('a member of an organization that requires MFA must enroll first', async () => {
      const { service, credentials } = setup(active, true);
      credentials.requiresMfaByMembership.mockResolvedValue(true);
      await expect(service.login(request)).resolves.toMatchObject({ step: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' });
      expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), active.id, false);
    });
  });
});
