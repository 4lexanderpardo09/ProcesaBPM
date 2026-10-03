import { Inject, Injectable } from '@nestjs/common';
import { type FailedOutboxEvent, type ListFailedEventsQuery, NotFoundError, type Page, type PlatformMetrics } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { OperationsRepository } from '../data/operations.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

const METRICS_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What operators need to keep the platform healthy: stuck outbox events and global figures. Payloads are never shown. */
@Injectable()
export class OperationsService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(OperationsRepository) private readonly operations: OperationsRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  listFailedEvents(query: ListFailedEventsQuery): Promise<Page<FailedOutboxEvent>> {
    return this.runner.run((tx) =>
      query.scope === 'PLATFORM' ? this.operations.listFailedPlatformEvents(tx, query.page, query.pageSize) : this.operations.listFailedTenantEvents(tx, query.page, query.pageSize),
    );
  }

  retryPlatformEvent(actorUserId: string, id: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if (!(await this.operations.retryPlatformEvent(tx, id))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.outboxEventRetried, data: { scope: 'PLATFORM', id } });
    });
  }

  retryTenantEvent(actorUserId: string, tenantId: string, id: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if (!(await this.operations.retryTenantEvent(tx, tenantId, id))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.outboxEventRetried, targetTenantId: tenantId, data: { scope: 'TENANT', id } });
    });
  }

  metrics(): Promise<PlatformMetrics> {
    const since = new Date(this.clock.now().getTime() - METRICS_WINDOW_DAYS * DAY_MS);
    return this.runner.run((tx) => this.operations.metrics(tx, since));
  }
}
