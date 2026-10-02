import { Inject, Injectable } from '@nestjs/common';
import {
  backlogFiltersSchema,
  PermissionDeniedError,
  rankingFiltersSchema,
  reportFiltersSchema,
  ReportTooLargeError,
  type ReportName,
  userDetailExportSchema,
  ValidationFailedError,
} from '@procesabpm/shared';
import type { z } from 'zod';
import { Clock } from '../../../infrastructure/clock.js';
import { SpreadsheetWriter, type Sheet } from '../../../infrastructure/spreadsheet/spreadsheet-writer.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { reportsEs as es } from '../i18n/es.js';
import { backlogSheets, categoriesSheets, distributionSheets, incidentsSheets, rankingSheets, responsiblesSheets, rowCount, stepsSheets, summarySheets, userDetailSheets } from '../domain/report-sheets.js';
import { BreakdownReportsService } from './breakdown-reports.service.js';
import { PerformanceReportsService } from './performance-reports.service.js';
import { exportAccess } from './report-runner.js';

/** The most rows a workbook generated on the spot may have: more than that is a filter too wide for a spreadsheet. */
export const EXPORT_ROW_CAP = 10_000;

export interface ExportedReport {
  readonly buffer: Buffer;
  readonly fileName: string;
}

type Query = Readonly<Record<string, unknown>>;

function parse<S extends z.ZodType>(schema: S, query: Query): z.output<S> {
  const result = schema.safeParse(query);
  if (!result.success) throw new ValidationFailedError(result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
  return result.data;
}

/**
 * The report as a workbook, generated on the spot: the data are aggregates, so the workbook is small and bounded by a row
 * cap. The export needs `export Report` as well as `read Report`: the caller sees the narrowest of the two scopes.
 */
@Injectable()
export class ReportExportService {
  constructor(
    @Inject(PerformanceReportsService) private readonly performance: PerformanceReportsService,
    @Inject(BreakdownReportsService) private readonly breakdown: BreakdownReportsService,
    @Inject(SpreadsheetWriter) private readonly writer: SpreadsheetWriter,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async export(ability: AppAbility, report: ReportName, query: Query): Promise<ExportedReport> {
    if (!ability.can('read', 'Report')) throw new PermissionDeniedError('Exporting a report needs reading it too');
    const access = exportAccess(ability);
    const sheets = await this.sheetsOf(access, report, query);
    if (rowCount(sheets) > EXPORT_ROW_CAP) throw new ReportTooLargeError(EXPORT_ROW_CAP);
    const buffer = await this.writer.write([...sheets, this.filtersSheet(query)]);
    return { buffer, fileName: `reporte-${report}-${this.clock.now().toISOString().slice(0, 10)}.xlsx` };
  }

  private async sheetsOf(access: ReturnType<typeof exportAccess>, report: ReportName, query: Query): Promise<Sheet[]> {
    switch (report) {
      case 'summary':
        return summarySheets(await this.performance.summary(access, parse(reportFiltersSchema, query)));
      case 'sla-responsibles':
        return responsiblesSheets((await this.performance.responsibles(access, { ...parse(reportFiltersSchema, query), page: 1, pageSize: EXPORT_ROW_CAP + 1 })).items);
      case 'sla-steps':
        return stepsSheets(await this.performance.steps(access, parse(reportFiltersSchema, query)));
      case 'ranking':
        return rankingSheets(await this.performance.ranking(access, parse(rankingFiltersSchema, query)));
      case 'time-distribution':
        return distributionSheets(await this.performance.timeDistribution(access, parse(reportFiltersSchema, query)));
      case 'incidents':
        return incidentsSheets(await this.breakdown.incidentsReport(access, parse(reportFiltersSchema, query)));
      case 'categories':
        return categoriesSheets(await this.breakdown.categories(access, parse(reportFiltersSchema, query)));
      case 'backlog':
        return backlogSheets(await this.breakdown.backlog(access, parse(backlogFiltersSchema, query)));
      case 'user-detail': {
        const { userId } = parse(userDetailExportSchema, { userId: query.userId });
        const { userId: _selected, ...period } = query;
        return userDetailSheets(await this.performance.detail(access, userId, { ...parse(reportFiltersSchema, period), page: 1, pageSize: EXPORT_ROW_CAP + 1 }));
      }
    }
  }

  /** What was asked, so the file explains itself. */
  private filtersSheet(query: Query): Sheet {
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    return {
      name: es.filters.sheet,
      headers: [es.filters.name, es.filters.value],
      rows: [
        [es.filters.from, text(query.from)],
        [es.filters.to, text(query.to)],
        [es.filters.company, text(query.companyId)],
        [es.filters.workflow, text(query.workflowId)],
        [es.filters.department, text(query.departmentId)],
        [es.filters.site, text(query.siteId)],
        [es.filters.generatedAt, this.clock.now()],
      ],
    };
  }
}
