import { Inject, Injectable } from '@nestjs/common';
import { InvalidMfaCodeError, type MfaFactor } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { type AuthTransaction, AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { SecretDecryptionError } from '../../../infrastructure/crypto/aes-gcm-keyring.js';
import { MfaSecretCipher } from '../../../infrastructure/security/mfa-secret-cipher.js';
import { MfaRepository } from '../data/mfa.repository.js';
import { hashDisplayedCode } from '../domain/backup-codes.js';
import { matchTotp } from '../domain/totp.js';
import { SecurityNotifier } from './security-notifier.js';

export interface VerifiedFactor {
  /** Set when a backup code was used. */
  readonly backupCodesLeft?: number;
}

/**
 * Checks a code of the second factor the way the password is checked: the attempt is counted (and committed) BEFORE the
 * code is looked at, the accepted time step or backup code is consumed atomically, and a refused code, a repeated one and
 * a locked-out account all answer the same `INVALID_MFA_CODE`. What the caller needs to happen together with the
 * acceptance (consuming its challenge token, enabling MFA…) runs in the same transaction.
 */
@Injectable()
export class MfaFactorVerifier {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(MfaRepository) private readonly mfa: MfaRepository,
    @Inject(MfaSecretCipher) private readonly cipher: MfaSecretCipher,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(SecurityNotifier) private readonly notifier: SecurityNotifier,
  ) {}

  /**
   * `enabled`: whether the code verifies an active MFA (login, disabling) or the pending secret of an enrollment, which
   * only accepts a TOTP code (a user without MFA has no backup codes). When the attempt that locked the second factor was
   * wrong, the user is told.
   */
  async verify(userId: string, factor: MfaFactor, enabled: boolean, alsoInSameTransaction: (tx: AuthTransaction) => Promise<void>): Promise<VerifiedFactor> {
    const claim = await this.runner.withUserTransaction(userId, (tx) => this.mfa.claimAttempt(tx));
    if (!claim.claimed) throw new InvalidMfaCodeError();
    try {
      return await this.checkClaimed(userId, factor, enabled, alsoInSameTransaction);
    } catch (error) {
      if (claim.locking && error instanceof InvalidMfaCodeError) await this.notifier.notifyLockout(userId, 'MFA_LOCKED');
      throw error;
    }
  }

  private async checkClaimed(userId: string, factor: MfaFactor, enabled: boolean, alsoInSameTransaction: (tx: AuthTransaction) => Promise<void>): Promise<VerifiedFactor> {
    if ('backupCode' in factor) {
      const hash = hashDisplayedCode(factor.backupCode);
      if (!enabled || hash === undefined) throw new InvalidMfaCodeError();
      return this.runner.withUserTransaction(userId, async (tx) => {
        const left = await this.mfa.useBackupCode(tx, hash);
        if (left === undefined) throw new InvalidMfaCodeError();
        await alsoInSameTransaction(tx);
        return { backupCodesLeft: left };
      });
    }

    const status = await this.runner.withUserTransaction(userId, (tx) => this.mfa.status(tx));
    if (status.secretEncrypted === null || status.enabled !== enabled) throw new InvalidMfaCodeError();
    const opened = this.openSecret(userId, status.secretEncrypted);
    const step = matchTotp(opened.secret, factor.code, this.clock.now().getTime());
    if (step === null) throw new InvalidMfaCodeError();

    await this.runner.withUserTransaction(userId, async (tx) => {
      if (!(await this.mfa.acceptTotpStep(tx, step, enabled))) throw new InvalidMfaCodeError();
      await alsoInSameTransaction(tx);
    });
    if (opened.needsReencryption) await this.reencrypt(userId, status.secretEncrypted, opened.secret);
    return {};
  }

  private openSecret(userId: string, sealed: Buffer) {
    try {
      return this.cipher.open(userId, sealed);
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        // The key was removed too early, or the row was tampered with: the backup codes still work.
        this.logger.error(error, 'MfaFactorVerifier');
      }
      throw error;
    }
  }

  /** Best effort: the code was already accepted, so a failure here only postpones the rotation of this secret. */
  private async reencrypt(userId: string, oldSealed: Buffer, secret: Buffer): Promise<void> {
    try {
      await this.runner.withUserTransaction(userId, (tx) => this.mfa.reencryptSecret(tx, oldSealed, this.cipher.seal(userId, secret)));
    } catch (error) {
      this.logger.error(error, 'MfaFactorVerifier');
    }
  }
}
