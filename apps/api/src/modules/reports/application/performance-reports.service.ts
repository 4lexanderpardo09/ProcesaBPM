import { Inject, Injectable } from '@nestjs/common';
import type {
  PagedReportFilters,
  RankingFilters,
  RankingReport,
  RankingRow,
  ReportFilters,
  ResponsibleSlaRow,
  StepSlaRow,
  SummaryReport,
  TimeDistributionReport,
  UserDetailReport,
} from '@procesabpm/shared';
import type { Page } from '@procesabpm/shared';
import { type ClockStatsRow, PerformanceRepository } from '../data/performance.repository.js';
import type { ReportQuery } from '../data/report-sql.js';
import { pct, whole } from '../data/report-sql.js';
import { UserDetailRepository } from '../data/user-detail.repository.js';
import { rankPeople } from '../domain/ranking-score.js';
import { type ReportAccess, ReportRunner } from './report-runner.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

const toRankingRow = (row: ClockStatsRow, errors: number): Omit<RankingRow, 'rank' | 'compliance' | 'quality' | 'score'> & { userId: string; medianMin: number | null } => ({
  userId: row.userId!,
  name: row.name ?? '',
  delivered: row.delivered,
  onTime: row.onTime,
  late: row.late,
  errors,
  medianMin: whole(row.median),
});

/** The SLA reports: global figures, per responsible (their clock), per step (the visit), the ranking and the per-user detail. */
@Injectable()
export class PerformanceReportsService {
  constructor(
    @Inject(ReportRunner) private readonly runner: ReportRunner,
    @Inject(PerformanceRepository) private readonly repository: PerformanceRepository,
    @Inject(UserDetailRepository) private readonly userDetail: UserDetailRepository,
  ) {}

  summary(access: ReportAccess, filters: ReportFilters): Promise<SummaryReport> {
    return this.runner.run(access, filters, async (tx, query) => {
      const counts = await this.repository.counts(tx, query);
      const visits = await this.repository.visitResults(tx, query);
      const clocks = await this.repository.clockResults(tx, query);
      const resolution = await this.repository.resolution(tx, query);
      return {
        timeZones: await this.repository.timeZones(tx, query.tenantId, filters.companyId),
        ...counts,
        stepOnTimePct: pct(visits.onTime, visits.late),
        responsibleOnTimePct: pct(clocks.onTime, clocks.late),
        avgResolutionMin: whole(resolution.avg),
        medianResolutionMin: whole(resolution.median),
        unmeasuredTickets: resolution.unmeasured,
      };
    });
  }

  responsibles(access: ReportAccess, filters: PagedReportFilters): Promise<Page<ResponsibleSlaRow>> {
    return this.runner.run(access, filters, async (tx, query) => {
      const rows = (await this.repository.clockStats(tx, query)).map(
        (row): ResponsibleSlaRow => ({
          userId: row.userId,
          name: row.name,
          clocks: row.clocks,
          onTime: row.onTime,
          late: row.late,
          handedOff: row.handedOff,
          noSla: row.noSla,
          compliancePct: pct(row.onTime, row.late),
          avgMin: whole(row.avg),
          medianMin: whole(row.median),
          avgPausedMin: whole(row.avgPaused),
        }),
      );
      const start = (filters.page - 1) * filters.pageSize;
      return { items: rows.slice(start, start + filters.pageSize), page: filters.page, pageSize: filters.pageSize, total: rows.length };
    });
  }

  steps(access: ReportAccess, filters: ReportFilters): Promise<readonly StepSlaRow[]> {
    return this.runner.run(access, filters, async (tx, query) =>
      (await this.repository.visitStats(tx, query)).map(
        (row): StepSlaRow => ({
          workflowId: row.workflowId,
          workflowName: row.workflowName,
          stepName: row.stepName,
          visits: row.visits,
          onTime: row.onTime,
          late: row.late,
          noSla: row.noSla,
          compliancePct: pct(row.onTime, row.late),
          avgMin: whole(row.avg),
          medianMin: whole(row.median),
          p90Min: whole(row.p90),
          avgPausedMin: whole(row.avgPaused),
          reprocesses: row.reprocesses,
        }),
      ),
    );
  }

  ranking(access: ReportAccess, filters: RankingFilters): Promise<RankingReport> {
    return this.runner.run(access, filters, async (tx, query) => ({ minVolume: filters.minVolume, ...(await this.rankingOf(tx, query, filters.minVolume)) }));
  }

  timeDistribution(access: ReportAccess, filters: ReportFilters): Promise<TimeDistributionReport> {
    return this.runner.run(access, filters, async (tx, query) => {
      const round = whole;
      const byStep = (await this.repository.visitStats(tx, query)).filter((row) => row.median !== null).map((row) => ({
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        stepName: row.stepName,
        visits: row.visits,
        min: round(row.min),
        p25: round(row.p25),
        median: round(row.median),
        p75: round(row.p75),
        p90: round(row.p90),
        max: round(row.max),
      }));
      const byWorkflow = (await this.repository.resolutionByWorkflow(tx, query)).map((row) => ({
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        tickets: row.tickets,
        min: round(row.min),
        p25: round(row.p25),
        median: round(row.median),
        p75: round(row.p75),
        p90: round(row.p90),
        max: round(row.max),
      }));
      return { byStep, byWorkflow };
    });
  }

  /** One person: their standing in the ranking (without a minimum volume) and their clocks. Outside the member's scope there is simply nothing. */
  detail(access: ReportAccess, userId: string, filters: PagedReportFilters): Promise<UserDetailReport> {
    return this.runner.run(access, filters, async (tx, query) => {
      const { ranked, unranked } = await this.rankingOf(tx, query, 1, userId);
      const clocks = await this.userDetail.clocks(tx, query, userId, filters.page, filters.pageSize);
      const total = await this.userDetail.countClocks(tx, query, userId);
      const summary = [...ranked, ...unranked][0] ?? null;
      return {
        userId,
        // Nothing of this person is in the caller's scope: not even their name is told.
        name: summary === null && total === 0 ? null : await this.userDetail.name(tx, query.tenantId, userId),
        summary,
        clocks: {
          page: filters.page,
          pageSize: filters.pageSize,
          total,
          items: clocks.map((row) => ({
            ticketNumber: row.ticketNumber,
            workflowName: row.workflowName,
            stepName: row.stepName,
            loop: row.loop,
            startedAt: row.startedAt.toISOString(),
            completedAt: row.completedAt?.toISOString() ?? null,
            dueAt: row.dueAt?.toISOString() ?? null,
            businessMin: row.businessMin,
            pausedMin: row.pausedMin,
            result: row.result,
            completionReason: row.completionReason,
          })),
        },
      };
    });
  }

  private async rankingOf(tx: TenantTransaction, query: ReportQuery, minVolume: number, userId?: string): Promise<{ ranked: RankingRow[]; unranked: RankingRow[] }> {
    const clocks = (await this.repository.clockStats(tx, query, userId)).filter((row) => row.userId !== null);
    const errors = new Map((await this.repository.reopeningErrors(tx, query, userId)).map((row) => [row.userId, row]));
    const people = clocks.map((row) => toRankingRow(row, errors.get(row.userId!)?.errors ?? 0));
    for (const [id, row] of errors) if (!people.some((person) => person.userId === id)) people.push({ userId: id, name: row.name, delivered: 0, onTime: 0, late: 0, errors: row.errors, medianMin: null });
    const { ranked, unranked } = rankPeople(people, minVolume);
    return {
      ranked: ranked.map((person) => ({ ...person, rank: person.rank })),
      unranked: unranked.map((person) => ({ ...person, rank: null })),
    };
  }
}
