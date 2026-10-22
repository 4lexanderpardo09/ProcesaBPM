import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { ExportDefinitionsRepository } from '../data/export-definitions.repository.js';
import { ExportSourcesRepository } from '../data/export-sources.repository.js';
import { isCutoffDue } from '../domain/schedule.js';
import { ExportCutoffService } from './export-cutoff.service.js';

export const EXPORT_TENANT_BATCH = 500;

/**
 * Runs the scheduled cutoffs that are due: the database names the tenants with active exports, and each definition is
 * checked and cut in its own transaction (a failing one does not stop the others). A cutoff that found nothing still
 * closes its period, so what arrives later waits for the next one.
 */
@Injectable()
export class ExportCutoffJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ExportDefinitionsRepository) private readonly definitions: ExportDefinitionsRepository,
    @Inject(ExportSourcesRepository) private readonly sources: ExportSourcesRepository,
    @Inject(ExportCutoffService) private readonly cutoffs: ExportCutoffService,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async runOnce(): Promise<{ readonly cutoffs: number; readonly failed: number }> {
    const tenantIds = await this.runner.withoutTenant((tx) => tenantsWithExports(tx));
    let cutoffs = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      const ids = await this.runner.withTenant(tenantId, (tx) => this.definitions.activeIds(tx, tenantId));
      for (const definitionId of ids) {
        try {
          cutoffs += await this.runner.withTenant(tenantId, async (tx) => {
            const definition = await this.definitions.find(tx, tenantId, definitionId);
            if (definition === undefined || !definition.isActive) return 0;
            const now = this.clock.now();
            const timeZone = await this.sources.defaultTimeZone(tx, tenantId, definition.companyId);
            if (!isCutoffDue(definition.schedule, now, timeZone, definition.lastAutoCutoffAt)) return 0;
            return (await this.cutoffs.generate(tx, tenantId, definitionId, { manual: false, actorId: null, at: now })).cutoffIds.length;
          });
        } catch (error) {
          failed += 1;
          this.logger.error(error, 'ExportCutoffJob');
        }
      }
    }
    return { cutoffs, failed };
  }
}

async function tenantsWithExports(tx: CrossTenantTransaction): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ out_tenant_id: string }>>`SELECT out_tenant_id::text AS out_tenant_id FROM find_tenants_with_active_exports(${EXPORT_TENANT_BATCH})`;
  return rows.map((row) => row.out_tenant_id);
}
