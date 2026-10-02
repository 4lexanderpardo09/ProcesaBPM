import { Inject, Injectable } from '@nestjs/common';
import { type ChangePasswordRequest, InvalidCredentialsError, UnauthenticatedError } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';

@Injectable()
export class ChangePasswordService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  /**
   * The current password goes through the same claim-then-verify sequence as the login (a stolen access token cannot
   * be used to guess it, and the failures count against the same lockout). The database then stores the change, clears the
   * lockout and revokes every other session; the one that asked stays.
   */
  async change(principal: Principal, request: ChangePasswordRequest): Promise<void> {
    const email = await this.runner.withUserTransaction(principal.userId, (tx) => this.credentials.findEmail(tx, principal.userId));
    if (email === undefined) throw new UnauthenticatedError();
    const candidate = await this.runner.withAnonymousTransaction((tx) => this.credentials.findLoginCandidate(tx, email));
    const claimed =
      candidate !== undefined && (await this.runner.withAnonymousTransaction((tx) => this.credentials.claimLoginAttempt(tx, candidate.id)));
    const matches = await this.hasher.verify(claimed ? candidate.passwordHash : null, request.currentPassword);
    if (!claimed || !matches) throw new InvalidCredentialsError();

    const newHash = await this.hasher.hash(request.newPassword);
    await this.runner.withUserTransaction(principal.userId, (tx) => this.credentials.changeOwnPassword(tx, newHash, principal.sessionId));
  }
}
