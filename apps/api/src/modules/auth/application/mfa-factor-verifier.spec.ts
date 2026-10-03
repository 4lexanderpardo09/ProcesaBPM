import { InvalidMfaCodeError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { MfaSecretCipher } from '../../../infrastructure/security/mfa-secret-cipher.js';
import type { MfaRepository } from '../data/mfa.repository.js';
import type { AttemptClaim } from '../domain/attempt-claim.js';
import { newBackupCodes } from '../domain/backup-codes.js';
import { MfaFactorVerifier } from './mfa-factor-verifier.js';
import type { SecurityNotifier } from './security-notifier.js';

const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const BACKUP_CODE = newBackupCodes()[0]!;

function setup(claim: AttemptClaim, backupCodesLeft: number | undefined) {
  const runner = { withUserTransaction: vi.fn((_userId: string, work: (tx: object) => unknown) => work({})) } as unknown as AuthTransactionRunner;
  const mfa = {
    claimAttempt: vi.fn().mockResolvedValue(claim),
    useBackupCode: vi.fn().mockResolvedValue(backupCodesLeft),
    status: vi.fn().mockResolvedValue({ enabled: true, secretEncrypted: null, enabledAt: null, backupCodesLeft: 0 }),
  };
  const notifier = { notifyLockout: vi.fn().mockResolvedValue(undefined) };
  const verifier = new MfaFactorVerifier(
    runner,
    mfa as unknown as MfaRepository,
    {} as MfaSecretCipher,
    { now: () => new Date() } as Clock,
    { error: vi.fn() } as unknown as JsonLogger,
    notifier as unknown as SecurityNotifier,
  );
  return { verifier, mfa, notifier };
}

const nothingElse = () => Promise.resolve();

describe('MfaFactorVerifier lockout notice', () => {
  it('is queued once when the claim that locks the second factor has a wrong code', async () => {
    const { verifier, notifier } = setup({ claimed: true, locking: true }, undefined);
    await expect(verifier.verify(USER_ID, { backupCode: BACKUP_CODE }, true, nothingElse)).rejects.toBeInstanceOf(InvalidMfaCodeError);
    await expect(verifier.verify(USER_ID, { code: '123456' }, true, nothingElse)).rejects.toBeInstanceOf(InvalidMfaCodeError);
    expect(notifier.notifyLockout).toHaveBeenCalledTimes(2);
    expect(notifier.notifyLockout).toHaveBeenCalledWith(USER_ID, 'MFA_LOCKED');
  });

  it('is not queued when the locking claim has the right code', async () => {
    const { verifier, notifier } = setup({ claimed: true, locking: true }, 3);
    await expect(verifier.verify(USER_ID, { backupCode: BACKUP_CODE }, true, nothingElse)).resolves.toEqual({ backupCodesLeft: 3 });
    expect(notifier.notifyLockout).not.toHaveBeenCalled();
  });

  it('is not queued for a wrong code before the maximum, nor while already locked', async () => {
    for (const claim of [{ claimed: true, locking: false }, { claimed: false, locking: false }]) {
      const { verifier, notifier } = setup(claim, undefined);
      await expect(verifier.verify(USER_ID, { backupCode: BACKUP_CODE }, true, nothingElse)).rejects.toBeInstanceOf(InvalidMfaCodeError);
      expect(notifier.notifyLockout).not.toHaveBeenCalled();
    }
  });

  it('is not queued when the code was right but something else failed', async () => {
    const { verifier, notifier } = setup({ claimed: true, locking: true }, 3);
    const failure = new Error('challenge already used');
    await expect(verifier.verify(USER_ID, { backupCode: BACKUP_CODE }, true, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(notifier.notifyLockout).not.toHaveBeenCalled();
  });
});
