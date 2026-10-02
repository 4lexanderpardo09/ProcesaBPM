import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import type { AuditAction } from '../../audit/domain/audit-actions.js';

/**
 * Account events (password, second factor) are written to the trail of the organization of the session that made them.
 * The change itself runs without a tenant (the `auth_*` functions), so the row follows in its own tenant transaction.
 */
@Injectable()
export class AccountAudit {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(AuditTrail) private readonly trail: AuditTrail,
  ) {}

  record(principal: Principal, action: AuditAction, after?: unknown): Promise<void> {
    return this.runner.withTenantTransaction((tx) => this.trail.record(tx, { action, subjectType: 'User', subjectId: principal.userId, after }));
  }
}
