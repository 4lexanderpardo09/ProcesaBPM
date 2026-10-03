import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError, UnauthenticatedError } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { SecurityNotifier } from './security-notifier.js';

/**
 * Re-checks the password of a signed-in user before a sensitive change, with the same claim-then-verify sequence as the
 * login: a stolen access token cannot be used to guess the password, and the failures count against the same lockout (and
 * the guess that locks the account is mailed to its owner, as at login).
 */
@Injectable()
export class CurrentPasswordVerifier {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SecurityNotifier) private readonly notifier: SecurityNotifier,
  ) {}

  /** Throws `InvalidCredentialsError` (401) when the password is wrong or the account is locked. */
  async verify(userId: string, password: string): Promise<void> {
    const email = await this.runner.withUserTransaction(userId, (tx) => this.credentials.findEmail(tx, userId));
    if (email === undefined) throw new UnauthenticatedError();
    const candidate = await this.runner.withAnonymousTransaction((tx) => this.credentials.findLoginCandidate(tx, email));
    if (candidate === undefined) {
      await this.hasher.verify(null, password);
      throw new InvalidCredentialsError();
    }
    const claim = await this.runner.withAnonymousTransaction((tx) => this.credentials.claimLoginAttempt(tx, candidate.id));
    const matches = await this.hasher.verify(claim.claimed ? candidate.passwordHash : null, password);
    if (!claim.claimed || !matches) {
      if (claim.claimed && claim.locking) await this.notifier.notifyLockout(candidate.id, 'ACCOUNT_LOCKED');
      throw new InvalidCredentialsError();
    }
    // The password was right: give the claimed attempt back, or every sensitive change would leave one failure behind.
    await this.runner.withAnonymousTransaction((tx) => this.credentials.recordPasswordSuccess(tx, candidate.id, false));
  }
}
