import { z } from 'zod';
import { isoDateSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

export const MAX_REPORT_DAYS = 366;
const DAY_MS = 86_400_000;

/** Days between two `YYYY-MM-DD` dates, the last one included. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

const periodShape = {
  /** First day of the period, in the time zone of each ticket's company. */
  from: isoDateSchema,
  /** Last day of the period, included. */
  to: isoDateSchema,
  companyId: uuidSchema.optional(),
  workflowId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
};

const periodIsSane = (value: { from: string; to: string }): boolean => value.to >= value.from && daysBetween(value.from, value.to) <= MAX_REPORT_DAYS;
const PERIOD_MESSAGE = `The period must end on or after its start and last at most ${MAX_REPORT_DAYS} days`;

export const reportFiltersSchema = z.object(periodShape).strict().refine(periodIsSane, PERIOD_MESSAGE);
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

/** Reports whose rows are people or lists are paged. */
export const pagedReportFiltersSchema = z.object({ ...periodShape, ...paging }).strict().refine(periodIsSane, PERIOD_MESSAGE);
export type PagedReportFilters = z.infer<typeof pagedReportFiltersSchema>;

export const rankingFiltersSchema = z
  .object({ ...periodShape, minVolume: z.coerce.number().int().min(1).max(10_000).default(5) })
  .strict()
  .refine(periodIsSane, PERIOD_MESSAGE);
export type RankingFilters = z.infer<typeof rankingFiltersSchema>;

/** The backlog is a snapshot of now: it has no period. */
export const backlogFiltersSchema = z.object({ companyId: periodShape.companyId, workflowId: periodShape.workflowId, departmentId: periodShape.departmentId, siteId: periodShape.siteId }).strict();
export type BacklogFilters = z.infer<typeof backlogFiltersSchema>;

export const REPORT_NAMES = ['summary', 'sla-responsibles', 'sla-steps', 'ranking', 'time-distribution', 'incidents', 'categories', 'backlog', 'user-detail'] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const exportQuerySchema = z.object({ ...periodShape, from: isoDateSchema.optional(), to: isoDateSchema.optional(), minVolume: rankingFiltersSchema.shape.minVolume.optional(), userId: uuidSchema.optional() }).strict();
export type ExportQuery = z.infer<typeof exportQuerySchema>;
