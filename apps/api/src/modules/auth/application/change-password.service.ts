import { Inject, Injectable } from '@nestjs/common';
import type { ChangePasswordRequest } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { AccountAudit } from './account-audit.js';
import { CurrentPasswordVerifier } from './current-password-verifier.js';

@Injectable()
export class ChangePasswordService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(CurrentPasswordVerifier) private readonly currentPassword: CurrentPasswordVerifier,
    @Inject(AccountAudit) private readonly audit: AccountAudit,
  ) {}

  /**
   * The database stores the change, clears the lockout and revokes every other session; the one that asked stays.
   */
  async change(principal: Principal, request: ChangePasswordRequest): Promise<void> {
    await this.currentPassword.verify(principal.userId, request.currentPassword);
    const newHash = await this.hasher.hash(request.newPassword);
    await this.runner.withUserTransaction(principal.userId, (tx) => this.credentials.changeOwnPassword(tx, newHash, principal.sessionId));
    await this.audit.record(principal, 'account.password_changed');
  }
}
