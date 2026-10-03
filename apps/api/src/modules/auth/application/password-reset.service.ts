import { Inject, Injectable } from '@nestjs/common';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { PASSWORD_RESET_EVENT } from '../../../infrastructure/outbox/platform-event-types.js';
import { OneTimeTokenService } from './one-time-token.service.js';
import { SecurityNotifier } from './security-notifier.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(OneTimeTokenService) private readonly oneTimeTokens: OneTimeTokenService,
    @Inject(SecurityNotifier) private readonly notifier: SecurityNotifier,
  ) {}

  /**
   * For an active account the e-mail is queued in the platform outbox (which belongs to no tenant, so it works even when
   * the user has no organization). The event carries only the user id: the worker issues the one-time token, stores its
   * hash and mails the link, so no token ever sits in the database in the clear.
   */
  async request(email: string): Promise<void> {
    const candidate = await this.runner.withAnonymousTransaction((tx) => this.credentials.findLoginCandidate(tx, email));
    if (candidate?.status !== 'ACTIVE') return;
    await this.runner.withAnonymousTransaction((tx) => this.outbox.enqueue(tx, PASSWORD_RESET_EVENT, { userId: candidate.id }));
  }

  /** Sets the new password; the database also clears the lockout and revokes every session. The user is told by e-mail. */
  async confirm(token: string, newPassword: string): Promise<void> {
    await this.oneTimeTokens.consume('PASSWORD_RESET', token, newPassword, (tx, consumed) => this.notifier.notify(tx, consumed.userId, 'PASSWORD_RESET'));
  }
}
