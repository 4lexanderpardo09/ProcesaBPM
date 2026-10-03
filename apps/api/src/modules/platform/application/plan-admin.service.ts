import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type PlanSummary, type UpdatePlanRequest } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PlanAdminRepository } from '../data/plan-admin.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** Plan limits apply live: every tenant's quota is computed from its plan, so an edit takes effect at once. */
@Injectable()
export class PlanAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(PlanAdminRepository) private readonly plans: PlanAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  list(): Promise<PlanSummary[]> {
    return this.runner.run((tx) => this.plans.list(tx));
  }

  update(actorUserId: string, code: string, change: UpdatePlanRequest): Promise<PlanSummary> {
    return this.runner.run(async (tx) => {
      const before = await this.plans.find(tx, code);
      if (before === undefined) throw new NotFoundError();
      await this.plans.update(tx, code, change);
      const after = (await this.plans.find(tx, code))!;
      const changed = Object.keys(change) as Array<keyof UpdatePlanRequest>;
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.planUpdated,
        data: { code, from: Object.fromEntries(changed.map((key) => [key, before[key]])), to: Object.fromEntries(changed.map((key) => [key, after[key]])) },
      });
      return after;
    });
  }
}
