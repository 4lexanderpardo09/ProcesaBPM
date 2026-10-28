import { Inject, Injectable } from '@nestjs/common';
import { type DemoRequestSummary, type ListDemoRequestsQuery, type MarkDemoRequest, NotFoundError, type Page } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { DemoRequestAdminRepository } from '../data/demo-request-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** The demo requests from the website, for whoever answers them from the platform console. */
@Injectable()
export class DemoRequestAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(DemoRequestAdminRepository) private readonly requests: DemoRequestAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  list(query: ListDemoRequestsQuery): Promise<Page<DemoRequestSummary>> {
    return this.runner.run((tx) => this.requests.list(tx, query));
  }

  /** The audit keeps who marked what, without the person's data (it outlives the request: 5 years against 24 months). */
  mark(actorUserId: string, id: string, change: MarkDemoRequest): Promise<DemoRequestSummary> {
    return this.runner.run(async (tx) => {
      const marked = await this.requests.mark(tx, id, actorUserId, change);
      if (marked === undefined) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.demoRequestMarked, data: { id, status: change.status } });
      return marked;
    });
  }
}
