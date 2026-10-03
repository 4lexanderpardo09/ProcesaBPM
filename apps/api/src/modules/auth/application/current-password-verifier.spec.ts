import { InvalidCredentialsError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import type { CredentialsRepository } from '../data/credentials.repository.js';
import type { AttemptClaim } from '../domain/attempt-claim.js';
import { CurrentPasswordVerifier } from './current-password-verifier.js';
import type { SecurityNotifier } from './security-notifier.js';

const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';

function setup(claim: AttemptClaim, passwordMatches: boolean) {
  const runner = {
    withAnonymousTransaction: vi.fn((work: (tx: object) => unknown) => work({})),
    withUserTransaction: vi.fn((_userId: string, work: (tx: object) => unknown) => work({})),
  } as unknown as AuthTransactionRunner;
  const credentials = {
    findEmail: vi.fn().mockResolvedValue('ana@example.com'),
    findLoginCandidate: vi.fn().mockResolvedValue({ id: USER_ID, passwordHash: '$argon2id$stored', status: 'ACTIVE', mfaEnabled: false }),
    claimLoginAttempt: vi.fn().mockResolvedValue(claim),
    recordPasswordSuccess: vi.fn().mockResolvedValue(undefined),
  };
  const hasher = { verify: vi.fn().mockResolvedValue(passwordMatches) };
  const notifier = { notifyLockout: vi.fn().mockResolvedValue(undefined) };
  const verifier = new CurrentPasswordVerifier(runner, credentials as unknown as CredentialsRepository, hasher as unknown as PasswordHasher, notifier as unknown as SecurityNotifier);
  return { verifier, credentials, hasher, notifier };
}

describe('CurrentPasswordVerifier', () => {
  it('a right password gives the claimed attempt back', async () => {
    const { verifier, credentials } = setup({ claimed: true, locking: false }, true);
    await verifier.verify(USER_ID, 'secret');
    expect(credentials.recordPasswordSuccess).toHaveBeenCalledWith(expect.anything(), USER_ID, false);
  });

  it('a locked account is refused even with the right password, which is never checked against the real hash', async () => {
    const { verifier, credentials, hasher } = setup({ claimed: false, locking: false }, true);
    await expect(verifier.verify(USER_ID, 'secret')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(hasher.verify).toHaveBeenCalledWith(null, 'secret');
    expect(credentials.recordPasswordSuccess).not.toHaveBeenCalled();
  });

  it('the wrong guess that locks the account is mailed once; earlier wrong guesses are not', async () => {
    const locking = setup({ claimed: true, locking: true }, false);
    await expect(locking.verifier.verify(USER_ID, 'guess')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(locking.notifier.notifyLockout).toHaveBeenCalledWith(USER_ID, 'ACCOUNT_LOCKED');

    const earlier = setup({ claimed: true, locking: false }, false);
    await expect(earlier.verifier.verify(USER_ID, 'guess')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(earlier.notifier.notifyLockout).not.toHaveBeenCalled();
  });

  it('the right password on the locking attempt is not mailed', async () => {
    const { verifier, notifier } = setup({ claimed: true, locking: true }, true);
    await verifier.verify(USER_ID, 'secret');
    expect(notifier.notifyLockout).not.toHaveBeenCalled();
  });
});
