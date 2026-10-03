import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, mapDatabaseError, MfaAlreadyEnabledError, type MfaEnrollment, UnauthenticatedError } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { MfaSecretCipher } from '../../../infrastructure/security/mfa-secret-cipher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { MfaRepository } from '../data/mfa.repository.js';
import { MFA_POLICY } from '../domain/auth-policy.js';
import { base32Encode, newTotpSecret, otpauthUri, TOTP } from '../domain/totp.js';
import { hashBackupCode, newBackupCodes, normalizeBackupCode } from '../domain/backup-codes.js';

export interface NewBackupCodes {
  /** For the user, shown once. */
  readonly displayed: string[];
  /** For the database. */
  readonly hashes: string[];
}

/** The two halves of enrolling in the second factor, shared by the account routes and the login-time enrollment. */
@Injectable()
export class MfaEnrollmentService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(MfaRepository) private readonly mfa: MfaRepository,
    @Inject(MfaSecretCipher) private readonly cipher: MfaSecretCipher,
  ) {}

  /** Stores a fresh pending secret (starting over replaces the previous one) and describes it for the authenticator app. */
  async begin(userId: string): Promise<MfaEnrollment> {
    const email = await this.runner.withUserTransaction(userId, (tx) => this.credentials.findEmail(tx, userId));
    if (email === undefined) throw new UnauthenticatedError();
    const secret = newTotpSecret();
    const sealed = this.cipher.seal(userId, secret);
    try {
      await this.runner.withUserTransaction(userId, (tx) => this.mfa.storePendingSecret(tx, sealed));
    } catch (error) {
      if (mapDatabaseError(error) instanceof InvalidStateError) throw new MfaAlreadyEnabledError();
      throw error;
    }
    return {
      secret: base32Encode(secret),
      otpauthUri: otpauthUri({ issuer: MFA_POLICY.issuer, account: email, secret }),
      issuer: MFA_POLICY.issuer,
      accountName: email,
      algorithm: 'SHA1',
      digits: TOTP.digits,
      period: TOTP.periodSeconds,
    };
  }

  newBackupCodes(): NewBackupCodes {
    const displayed = newBackupCodes();
    return { displayed, hashes: displayed.map((code) => hashBackupCode(normalizeBackupCode(code)!)) };
  }
}

