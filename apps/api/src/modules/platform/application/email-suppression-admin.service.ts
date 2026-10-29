import { Inject, Injectable } from '@nestjs/common';
import { type EmailSuppressionSummary, type ListEmailSuppressionsQuery, NotFoundError, type Page } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { EmailSuppressionAdminRepository } from '../data/email-suppression-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** The addresses SES told us not to write to again, for the platform console: listed, and removed when one works again. */
@Injectable()
export class EmailSuppressionAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(EmailSuppressionAdminRepository) private readonly suppressions: EmailSuppressionAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  list(query: ListEmailSuppressionsQuery): Promise<Page<EmailSuppressionSummary>> {
    return this.runner.run((tx) => this.suppressions.list(tx, query));
  }

  /** The audit keeps who let the address back in and why it had been suppressed (the address is a person's data: not kept). */
  remove(actorUserId: string, id: string): Promise<void> {
    return this.runner.run(async (tx) => {
      const removed = await this.suppressions.remove(tx, id);
      if (removed === undefined) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.emailSuppressionRemoved, data: { id, reason: removed.reason, events: removed.events } });
    });
  }
}
