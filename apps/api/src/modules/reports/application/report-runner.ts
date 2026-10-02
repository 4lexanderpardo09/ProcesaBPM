import { Inject, Injectable } from '@nestjs/common';
import type { ReportFilters } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import type { ReportQuery } from '../data/report-sql.js';
import { periodBounds } from '../domain/report-period.js';
import { compileReportScope, intersectScopes, type ScopeSpec } from '../domain/report-scope.js';

/** A report may not hold a connection for long: a filter too wide fails instead of slowing everybody down. */
export const REPORT_STATEMENT_TIMEOUT_MS = 8000;

export type ReportAction = 'read' | 'export';

export interface ReportFilterInput {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly companyId?: string | undefined;
  readonly workflowId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly siteId?: string | undefined;
}

/** What the member may see for these actions: the narrowest of them. */
export function scopeOf(ability: AppAbility, actions: readonly ReportAction[]): ScopeSpec {
  return actions.map((action) => compileReportScope(ability.rulesFor(action, 'Report'))).reduce(intersectScopes);
}

/** Opens the tenant transaction, applies the time limit and gives the report its query: filters, period and scope together. */
@Injectable()
export class ReportRunner {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
  ) {}

  run<T>(ability: AppAbility, filters: ReportFilterInput, work: (tx: TenantTransaction, query: ReportQuery) => Promise<T>, actions: readonly ReportAction[] = ['read']): Promise<T> {
    const { tenantId } = this.context.require();
    const query: ReportQuery = {
      tenantId,
      period: periodBounds(filters.from ?? '2000-01-01', filters.to ?? '2000-01-01'),
      companyId: filters.companyId,
      workflowId: filters.workflowId,
      departmentId: filters.departmentId,
      siteId: filters.siteId,
      scope: scopeOf(ability, actions),
    };
    return this.runner.withTenantTransaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(REPORT_STATEMENT_TIMEOUT_MS)}, true)`;
      return work(tx, query);
    });
  }
}
