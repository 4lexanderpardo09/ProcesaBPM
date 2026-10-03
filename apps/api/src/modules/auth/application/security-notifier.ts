import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { type AuthTransaction, AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { SecurityNoticeKind } from '../../../infrastructure/outbox/platform-event-types.js';
import { SecurityNoticeRepository } from '../data/security-notice.repository.js';

export type LockoutNoticeKind = Extract<SecurityNoticeKind, 'ACCOUNT_LOCKED' | 'MFA_LOCKED'>;

/**
 * Tells the user, by e-mail, about a change to the security of their account. The worker sends it; the notice carries no
 * token and no link with a secret.
 */
@Injectable()
export class SecurityNotifier {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(SecurityNoticeRepository) private readonly notices: SecurityNoticeRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /** In the transaction of the change itself: both commit, or neither does. */
  async notify(tx: AuthTransaction, userId: string, kind: SecurityNoticeKind, sessionId?: string): Promise<void> {
    await this.notices.enqueue(tx, userId, kind, sessionId ?? null);
  }

  /**
   * After the attempt that locked the account (or the second factor) turned out wrong. The lock is already committed, so
   * this is its own transaction, and best effort: the caller answers the same error whether the notice was queued or not.
   */
  async notifyLockout(userId: string, kind: LockoutNoticeKind): Promise<void> {
    try {
      await this.runner.withAnonymousTransaction((tx) => this.notices.enqueue(tx, userId, kind, null));
    } catch (error) {
      this.logger.error(error, 'SecurityNotifier');
    }
  }
}
