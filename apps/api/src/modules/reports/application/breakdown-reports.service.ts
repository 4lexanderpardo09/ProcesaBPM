import { Inject, Injectable } from '@nestjs/common';
import type { BacklogFilters, BacklogReport, CategoryRow, IncidentsReport, ReportFilters } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { CatalogReportRepository, type CategoryStatsRow } from '../data/catalog-report.repository.js';
import { IncidentRepository } from '../data/incident.repository.js';

import { byAssignee, byOpener, byStep, groupIncidents } from '../domain/incident-groups.js';
import { type ReportAccess, ReportRunner } from './report-runner.js';

const average = (sum: number, count: number): number | null => (count === 0 ? null : Math.round(sum / count));
const round1 = (value: number | null): number | null => (value === null ? null : Math.round(value * 10) / 10);

/** A category row adds up its subcategories; the subcategory rows follow it. */
function withCategoryTotals(rows: readonly CategoryStatsRow[]): CategoryRow[] {
  const result: CategoryRow[] = [];
  for (const categoryId of [...new Set(rows.map((row) => row.categoryId))]) {
    const members = rows.filter((row) => row.categoryId === categoryId);
    const sum = (pick: (row: CategoryStatsRow) => number) => members.reduce((total, row) => total + pick(row), 0);
    result.push({
      categoryId,
      categoryName: members[0]!.categoryName,
      subcategoryId: null,
      subcategoryName: null,
      created: sum((row) => row.created),
      open: sum((row) => row.open),
      closed: sum((row) => row.closed),
      avgResolutionMin: average(sum((row) => row.resolutionSum), sum((row) => row.resolutionCount)),
    });
    for (const row of members) {
      result.push({ categoryId, categoryName: row.categoryName, subcategoryId: row.subcategoryId, subcategoryName: row.subcategoryName, created: row.created, open: row.open, closed: row.closed, avgResolutionMin: average(row.resolutionSum, row.resolutionCount) });
    }
  }
  return result;
}

/** Incidents, tickets by category and the backlog. */
@Injectable()
export class BreakdownReportsService {
  constructor(
    @Inject(ReportRunner) private readonly runner: ReportRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(CatalogReportRepository) private readonly catalog: CatalogReportRepository,
  ) {}

  incidentsReport(access: ReportAccess, filters: ReportFilters): Promise<IncidentsReport> {
    return this.runner.run(access, filters, async (tx, query) => {
      const rows = await this.incidents.rows(tx, query);
      return { byStep: groupIncidents(rows, byStep), byOpener: groupIncidents(rows, byOpener), byAssignee: groupIncidents(rows, byAssignee) };
    });
  }

  categories(access: ReportAccess, filters: ReportFilters): Promise<CategoryRow[]> {
    return this.runner.run(access, filters, async (tx, query) => withCategoryTotals(await this.catalog.categories(tx, query)));
  }

  /** A snapshot of now: the tickets that are not closed, with their age in calendar time. */
  backlog(access: ReportAccess, filters: BacklogFilters): Promise<BacklogReport> {
    const now = this.clock.now();
    return this.runner.run(access, filters, async (tx, query) => ({
      asOf: now.toISOString(),
      rows: (await this.catalog.backlog(tx, query, now)).map((row) => ({
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        stepName: row.stepName,
        open: row.open,
        paused: row.paused,
        overdue: row.overdue,
        avgAgeDays: round1(row.avgAgeDays),
        maxAgeDays: round1(row.maxAgeDays),
        avgHoursInStep: round1(row.avgHoursInStep),
        ageBuckets: row.ageBuckets as [number, number, number, number],
      })),
    }));
  }
}

