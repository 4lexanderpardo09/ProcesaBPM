import type {
  BacklogReport,
  CategoryRow,
  IncidentGroupRow,
  IncidentsReport,
  RankingReport,
  RankingRow,
  ResponsibleSlaRow,
  StepSlaRow,
  SummaryReport,
  TimeDistributionReport,
  UserDetailReport,
} from '@procesabpm/shared';
import type { Sheet, SheetCell } from '../../../infrastructure/spreadsheet/spreadsheet-writer.js';
import { reportsEs as es } from '../i18n/es.js';

const result = (value: 'ON_TIME' | 'LATE' | null): string | null => (value === 'ON_TIME' ? es.user.onTime : value === 'LATE' ? es.user.late : null);

export const summarySheets = (report: SummaryReport): Sheet[] => [
  {
    name: es.summary.sheet,
    headers: [es.summary.metric, es.summary.value],
    rows: [
      [es.summary.created, report.created],
      [es.summary.closed, report.closed],
      [es.summary.open, report.open],
      [es.summary.stepOnTimePct, report.stepOnTimePct],
      [es.summary.responsibleOnTimePct, report.responsibleOnTimePct],
      [es.summary.avgResolutionMin, report.avgResolutionMin],
      [es.summary.medianResolutionMin, report.medianResolutionMin],
      [es.summary.unmeasuredTickets, report.unmeasuredTickets],
    ],
  },
];

export const responsiblesSheets = (rows: readonly ResponsibleSlaRow[]): Sheet[] => [
  {
    name: es.responsibles.sheet,
    headers: [es.responsibles.user, es.responsibles.clocks, es.responsibles.onTime, es.responsibles.late, es.responsibles.handedOff, es.responsibles.noSla, es.responsibles.compliance, es.responsibles.avg, es.responsibles.median, es.responsibles.paused],
    rows: rows.map((row) => [row.name ?? es.responsibles.pool, row.clocks, row.onTime, row.late, row.handedOff, row.noSla, row.compliancePct, row.avgMin, row.medianMin, row.avgPausedMin]),
  },
];

export const stepsSheets = (rows: readonly StepSlaRow[]): Sheet[] => [
  {
    name: es.steps.sheet,
    headers: [es.steps.workflow, es.steps.step, es.steps.visits, es.steps.onTime, es.steps.late, es.steps.noSla, es.steps.compliance, es.steps.avg, es.steps.median, es.steps.p90, es.steps.paused, es.steps.reprocesses],
    rows: rows.map((row) => [row.workflowName, row.stepName, row.visits, row.onTime, row.late, row.noSla, row.compliancePct, row.avgMin, row.medianMin, row.p90Min, row.avgPausedMin, row.reprocesses]),
  },
];

const rankingRow = (row: RankingRow): SheetCell[] => [row.rank, row.name, row.delivered, row.onTime, row.late, row.errors, row.compliance === null ? null : Math.round(row.compliance * 1000) / 10, row.quality === null ? null : Math.round(row.quality * 1000) / 10, row.score, row.medianMin];
const rankingHeaders = [es.ranking.rank, es.ranking.user, es.ranking.delivered, es.ranking.onTime, es.ranking.late, es.ranking.errors, `${es.ranking.compliance} (%)`, `${es.ranking.quality} (%)`, es.ranking.score, es.ranking.median];

export const rankingSheets = (report: RankingReport): Sheet[] => [
  { name: es.ranking.sheet, headers: rankingHeaders, rows: report.ranked.map(rankingRow) },
  { name: es.ranking.unranked, headers: rankingHeaders, rows: report.unranked.map(rankingRow) },
];

export const distributionSheets = (report: TimeDistributionReport): Sheet[] => [
  {
    name: es.distribution.stepSheet,
    headers: [es.distribution.workflow, es.distribution.step, es.distribution.count, es.distribution.min, es.distribution.p25, es.distribution.median, es.distribution.p75, es.distribution.p90, es.distribution.max],
    rows: report.byStep.map((row) => [row.workflowName, row.stepName, row.visits, row.min, row.p25, row.median, row.p75, row.p90, row.max]),
  },
  {
    name: es.distribution.workflowSheet,
    headers: [es.distribution.workflow, es.distribution.count, es.distribution.min, es.distribution.p25, es.distribution.median, es.distribution.p75, es.distribution.p90, es.distribution.max],
    rows: report.byWorkflow.map((row) => [row.workflowName, row.tickets, row.min, row.p25, row.median, row.p75, row.p90, row.max]),
  },
];

const incidentSheet = (name: string, rows: readonly IncidentGroupRow[]): Sheet => ({
  name,
  headers: [es.incidents.group, es.incidents.count, es.incidents.open, es.incidents.resolved, es.incidents.avgPaused, es.incidents.medianPaused],
  rows: rows.map((row) => [row.label, row.count, row.open, row.resolved, row.avgPausedMin, row.medianPausedMin]),
});

export const incidentsSheets = (report: IncidentsReport): Sheet[] => [incidentSheet(es.incidents.stepSheet, report.byStep), incidentSheet(es.incidents.openerSheet, report.byOpener), incidentSheet(es.incidents.assigneeSheet, report.byAssignee)];

export const categoriesSheets = (rows: readonly CategoryRow[]): Sheet[] => [
  {
    name: es.categories.sheet,
    headers: [es.categories.category, es.categories.subcategory, es.categories.created, es.categories.open, es.categories.closed, es.categories.avgResolution],
    rows: rows.map((row) => [row.categoryName, row.subcategoryName ?? es.categories.total, row.created, row.open, row.closed, row.avgResolutionMin]),
  },
];

export const backlogSheets = (report: BacklogReport): Sheet[] => [
  {
    name: es.backlog.sheet,
    headers: [es.backlog.workflow, es.backlog.step, es.backlog.open, es.backlog.paused, es.backlog.overdue, es.backlog.avgAge, es.backlog.maxAge, es.backlog.avgInStep, es.backlog.upTo1, es.backlog.upTo3, es.backlog.upTo7, es.backlog.over7],
    rows: report.rows.map((row) => [row.workflowName, row.stepName, row.open, row.paused, row.overdue, row.avgAgeDays, row.maxAgeDays, row.avgHoursInStep, ...row.ageBuckets]),
  },
];

export const userDetailSheets = (report: UserDetailReport): Sheet[] => [
  ...(report.summary === null ? [] : [{ name: es.user.summarySheet, headers: rankingHeaders, rows: [rankingRow(report.summary)] }]),
  {
    name: es.user.clocksSheet,
    headers: [es.user.ticket, es.user.workflow, es.user.step, es.user.loop, es.user.startedAt, es.user.completedAt, es.user.dueAt, es.user.business, es.user.paused, es.user.result, es.user.reason],
    rows: report.clocks.items.map((row) => [row.ticketNumber, row.workflowName, row.stepName, row.loop, new Date(row.startedAt), row.completedAt === null ? null : new Date(row.completedAt), row.dueAt === null ? null : new Date(row.dueAt), row.businessMin, row.pausedMin, result(row.result), row.completionReason]),
  },
];

/** Rows in all the sheets of a workbook. */
export const rowCount = (sheets: readonly Sheet[]): number => sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
