import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { PASSWORD_RESET_EMAIL_EVENT, PASSWORD_RESET_TTL_MS } from '../domain/auth-policy.js';
import { OneTimeTokenService } from './one-time-token.service.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(OneTimeTokenService) private readonly oneTimeTokens: OneTimeTokenService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * For an active account: a 30-minute token is issued and the e-mail is queued in the platform
   * outbox (which belongs to no tenant, so it works even when the user has no organization). Token
   * and event are written in one transaction. The payload carries the clear token for the worker,
   * which is the only role that can read it; completing the event removes it.
   */
  async request(email: string): Promise<void> {
    const candidate = await this.runner.withAnonymousTransaction((tx) => this.credentials.findLoginCandidate(tx, email));
    if (candidate?.status !== 'ACTIVE') return;

    const token = generateOpaqueToken();
    const expiresAt = new Date(this.clock.now().getTime() + PASSWORD_RESET_TTL_MS);
    await this.runner.withAnonymousTransaction(async (tx) => {
      await this.credentials.issueToken(tx, { userId: candidate.id, type: 'PASSWORD_RESET', tokenHash: sha256Hex(token), expiresAt });
      await this.outbox.enqueue(tx, PASSWORD_RESET_EMAIL_EVENT, {
        userId: candidate.id,
        email,
        token,
        expiresAt: expiresAt.toISOString(),
      });
    });
  }

  /** Sets the new password; the database also clears the lockout and revokes every session. */
  async confirm(token: string, newPassword: string): Promise<void> {
    await this.oneTimeTokens.consume('PASSWORD_RESET', token, newPassword);
  }
}
