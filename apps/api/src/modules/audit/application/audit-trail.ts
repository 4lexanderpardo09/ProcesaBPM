import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../../../common/logging/request-context.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditLogRepository } from '../data/audit-log.repository.js';
import type { AuditAction } from '../domain/audit-actions.js';
import { sanitizeAuditSummary } from '../domain/audit-summary.js';

export interface AuditEntry {
  readonly action: AuditAction;
  /** The CASL subject of the thing that changed (`Role`, `Membership`, `Workflow`…). */
  readonly subjectType: string;
  readonly subjectId: string | null;
  /** A summary, not a row: ids, names, flags. Secret-looking keys are dropped. */
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Writes one audit row in the transaction of the action it records: the row commits with the action or not at all, so
 * a failed action leaves no trace and a successful one cannot lose it. The tenant and the actor come from the request
 * scope (never from the caller), and the address, user agent and request id from the request context.
 */
@Injectable()
export class AuditTrail {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
    @Inject(AuditLogRepository) private readonly logs: AuditLogRepository,
  ) {}

  async record(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    const { tenantId, userId, supportGrantId } = this.tenantContext.require();
    const request = this.requestContext.current();
    await this.logs.insert(tx, {
      tenantId,
      // Under a support grant the actor is the platform administrator, who is not a member: the row says so explicitly.
      actorId: supportGrantId === undefined ? userId : null,
      supportActorId: supportGrantId === undefined ? null : userId,
      supportGrantId: supportGrantId ?? null,
      action: entry.action,
      entityType: entry.subjectType,
      entityId: entry.subjectId,
      before: sanitizeAuditSummary(entry.before),
      after: sanitizeAuditSummary(entry.after),
      ipAddress: request?.ipAddress ?? null,
      userAgent: request?.userAgent ?? null,
      requestId: request?.requestId ?? null,
    });
    request?.auditedActions?.add(entry.action);
  }
}
