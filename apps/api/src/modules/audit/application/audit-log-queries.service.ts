import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_DEFAULT_RANGE_DAYS, AUDIT_MAX_RANGE_DAYS, type AuditLogPage, type AuditLogQuery, ValidationFailedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditLogRepository } from '../data/audit-log.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads the tenant's own trail; the tenant filter is explicit on top of row-level security. */
@Injectable()
export class AuditLogQueriesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(AuditLogRepository) private readonly logs: AuditLogRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const to = query.to ?? this.clock.now();
    const from = query.from ?? new Date(to.getTime() - AUDIT_DEFAULT_RANGE_DAYS * DAY_MS);
    if (from > to) throw new ValidationFailedError([{ path: 'from', message: 'must not be after "to"' }]);
    if (to.getTime() - from.getTime() > AUDIT_MAX_RANGE_DAYS * DAY_MS) {
      throw new ValidationFailedError([{ path: 'from', message: `the range cannot exceed ${AUDIT_MAX_RANGE_DAYS} days` }]);
    }
    const { tenantId } = this.context.require();
    const rows = await this.runner.withTenantTransaction((tx) => this.logs.find(tx, { ...query, tenantId, from, to }));
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({ ...row, at: row.at.toISOString() })),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }
}
