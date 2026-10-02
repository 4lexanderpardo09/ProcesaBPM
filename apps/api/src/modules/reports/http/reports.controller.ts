import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  type BacklogFilters,
  backlogFiltersSchema,
  type BacklogReport,
  type CategoryRow,
  type IncidentsReport,
  type Page,
  type PagedReportFilters,
  pagedReportFiltersSchema,
  type RankingFilters,
  rankingFiltersSchema,
  type RankingReport,
  type ReportFilters,
  reportFiltersSchema,
  type ResponsibleSlaRow,
  type StepSlaRow,
  type SummaryReport,
  type TimeDistributionReport,
  type UserDetailReport,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { BreakdownReportsService } from '../application/breakdown-reports.service.js';
import { PerformanceReportsService } from '../application/performance-reports.service.js';

const filters = new ZodValidationPipe(reportFiltersSchema);
const paged = new ZodValidationPipe(pagedReportFiltersSchema);

/** Live reports over the tenant's tickets. What each one shows is limited by the scope of the caller's `read Report` permission. */
@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(PerformanceReportsService) private readonly performance: PerformanceReportsService,
    @Inject(BreakdownReportsService) private readonly breakdown: BreakdownReportsService,
  ) {}

  @RequirePermission('read', 'Report')
  @Get('summary')
  summary(@CurrentAbility() ability: AppAbility, @Query(filters) query: ReportFilters): Promise<SummaryReport> {
    return this.performance.summary(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('sla/responsibles')
  responsibles(@CurrentAbility() ability: AppAbility, @Query(paged) query: PagedReportFilters): Promise<Page<ResponsibleSlaRow>> {
    return this.performance.responsibles(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('sla/steps')
  steps(@CurrentAbility() ability: AppAbility, @Query(filters) query: ReportFilters): Promise<readonly StepSlaRow[]> {
    return this.performance.steps(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('ranking')
  ranking(@CurrentAbility() ability: AppAbility, @Query(new ZodValidationPipe(rankingFiltersSchema)) query: RankingFilters): Promise<RankingReport> {
    return this.performance.ranking(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('time-distribution')
  timeDistribution(@CurrentAbility() ability: AppAbility, @Query(filters) query: ReportFilters): Promise<TimeDistributionReport> {
    return this.performance.timeDistribution(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('incidents')
  incidents(@CurrentAbility() ability: AppAbility, @Query(filters) query: ReportFilters): Promise<IncidentsReport> {
    return this.breakdown.incidentsReport(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('categories')
  categories(@CurrentAbility() ability: AppAbility, @Query(filters) query: ReportFilters): Promise<CategoryRow[]> {
    return this.breakdown.categories(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('backlog')
  backlog(@CurrentAbility() ability: AppAbility, @Query(new ZodValidationPipe(backlogFiltersSchema)) query: BacklogFilters): Promise<BacklogReport> {
    return this.breakdown.backlog(ability, query);
  }

  @RequirePermission('read', 'Report')
  @Get('users/:userId')
  user(@CurrentAbility() ability: AppAbility, @Param('userId', ParseUUIDPipe) userId: string, @Query(paged) query: PagedReportFilters): Promise<UserDetailReport> {
    return this.performance.detail(ability, userId, query);
  }
}
