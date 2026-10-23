import { Inject, Injectable } from '@nestjs/common';
import type {
  BacklogTicketRow,
  BacklogTicketsFilters,
  HeatmapReport,
  HeatmapSite,
  Page,
  ReportFilters,
  ReportTicketRow,
  ReportTicketsFilters,
  SiteReport,
  SiteReportFilters,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { type CommentRow, ReportTicketsRepository, type TicketListRow, type WorkflowUsageRow } from '../data/report-tickets.repository.js';
import { pct, whole } from '../data/report-sql.js';
import { type HeatmapStatsRow, SiteReportRepository } from '../data/site-report.repository.js';
import { type ReportAccess, ReportRunner } from './report-runner.js';

/** The compliance the site chart draws as its reference line, as the help desk did. */
export const SITE_TARGET_PCT = 85;

const per100 = (part: number, whole: number): number | null => (whole === 0 ? null : Math.round((1000 * part) / whole) / 10);

export const toTicketRow = (row: TicketListRow): ReportTicketRow => ({ ...row, createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null });

/** Rows of one site in a row: the people of each site together, in the order the query gave them. */
function groupHeatmap(rows: readonly HeatmapStatsRow[]): HeatmapSite[] {
  const sites: HeatmapSite[] = [];
  for (const row of rows) {
    let site = sites.at(-1);
    if (site === undefined || site.siteId !== row.siteId) {
      site = { siteId: row.siteId, siteName: row.siteName, avgMin: whole(row.siteAvg), users: [] };
      sites.push(site);
    }
    (site.users as HeatmapSite['users'][number][]).push({
      userId: row.userId,
      name: row.name,
      delivered: row.delivered,
      processErrors: row.processErrors,
      otherErrors: row.otherErrors,
      avgMin: whole(row.avg),
      vsPeersPct: row.avg === null || row.siteAvg === null || row.siteAvg === 0 ? null : Math.round((row.avg / row.siteAvg - 1) * 100),
    });
  }
  return sites;
}

/** Reports by site (the help desk's regions), the heat map of people, and the tickets behind the numbers. */
@Injectable()
export class SiteReportsService {
  constructor(
    @Inject(ReportRunner) private readonly runner: ReportRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SiteReportRepository) private readonly sitesRepository: SiteReportRepository,
    @Inject(ReportTicketsRepository) private readonly tickets: ReportTicketsRepository,
  ) {}

  sites(access: ReportAccess, filters: SiteReportFilters): Promise<SiteReport> {
    return this.runner.run(access, filters, async (tx, query) => ({
      level: filters.level,
      targetPct: SITE_TARGET_PCT,
      rows: (await this.sitesRepository.sites(tx, query, filters.level)).map((row) => ({
        siteId: row.siteId,
        siteName: row.siteName,
        tickets: row.tickets,
        responsibles: row.responsibles,
        delivered: row.delivered,
        onTime: row.onTime,
        late: row.late,
        compliancePct: pct(row.onTime, row.late),
        processErrors: row.processErrors,
        otherErrors: row.otherErrors,
        errorPct: per100(row.processErrors + row.otherErrors, row.delivered),
        avgMin: whole(row.avg),
      })),
    }));
  }

  heatmap(access: ReportAccess, filters: SiteReportFilters): Promise<HeatmapReport> {
    return this.runner.run(access, filters, async (tx, query) => ({ level: filters.level, sites: groupHeatmap(await this.sitesRepository.heatmap(tx, query, filters.level)) }));
  }

  ticketList(access: ReportAccess, filters: ReportTicketsFilters): Promise<Page<ReportTicketRow>> {
    return this.runner.run(access, filters, async (tx, query) => {
      const { rows, total } = await this.tickets.tickets(tx, query, filters, { offset: (filters.page - 1) * filters.pageSize, limit: filters.pageSize });
      return { items: rows.map(toTicketRow), page: filters.page, pageSize: filters.pageSize, total };
    });
  }

  /** Up to `limit` tickets for a workbook (the caller checks the cap with one more). */
  ticketRows(access: ReportAccess, filters: ReportTicketsFilters, limit: number): Promise<ReportTicketRow[]> {
    return this.runner.run(access, filters, async (tx, query) => (await this.tickets.tickets(tx, query, filters, { offset: 0, limit })).rows.map(toTicketRow));
  }

  comments(access: ReportAccess, filters: ReportFilters, limit: number): Promise<CommentRow[]> {
    return this.runner.run(access, filters, (tx, query) => this.tickets.comments(tx, query, limit));
  }

  workflowUsage(access: ReportAccess, filters: ReportFilters): Promise<WorkflowUsageRow[]> {
    return this.runner.run(access, filters, (tx, query) => this.tickets.workflowUsage(tx, query));
  }

  backlogTickets(access: ReportAccess, filters: BacklogTicketsFilters): Promise<Page<BacklogTicketRow>> {
    const now = this.clock.now();
    return this.runner.run(access, filters, async (tx, query) => {
      const { rows, total } = await this.tickets.backlogTickets(tx, query, filters.stepName, now, { offset: (filters.page - 1) * filters.pageSize, limit: filters.pageSize });
      return {
        items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), enteredStepAt: row.enteredStepAt?.toISOString() ?? null, ageDays: Math.floor(row.ageDays) })),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      };
    });
  }
}
