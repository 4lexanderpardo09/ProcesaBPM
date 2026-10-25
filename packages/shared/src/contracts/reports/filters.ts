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
  .object({ ...periodShape, minVolume: z.coerce.number().int().min(1).max(10_000).default(1) })
  .strict()
  .refine(periodIsSane, PERIOD_MESSAGE);
export type RankingFilters = z.infer<typeof rankingFiltersSchema>;

/** The backlog is a snapshot of now: it has no period. */
export const backlogFiltersSchema = z.object({ companyId: periodShape.companyId, workflowId: periodShape.workflowId, departmentId: periodShape.departmentId, siteId: periodShape.siteId }).strict();
export type BacklogFilters = z.infer<typeof backlogFiltersSchema>;

/** Tickets are grouped by their site, raised to its ancestor at this level of the tree (1: the top one, e.g. the region). */
const siteLevel = z.coerce.number().int().min(1).max(10).default(1);

export const siteReportFiltersSchema = z.object({ ...periodShape, level: siteLevel }).strict().refine(periodIsSane, PERIOD_MESSAGE);
export type SiteReportFilters = z.infer<typeof siteReportFiltersSchema>;

/**
 * The tickets behind a number of a report. With `stepName` (and `workflowId`) or `responsibleId`, the tickets whose visit
 * of that step or whose clock of that person ended in the period; otherwise the tickets created in the period.
 * `underSiteId` takes a site and everything below it (a row of the report by site); `noSite` the tickets without one.
 */
export const reportTicketsFiltersSchema = z
  .object({
    ...periodShape,
    ...paging,
    categoryId: uuidSchema.optional(),
    subcategoryId: uuidSchema.optional(),
    stepName: z.string().trim().min(1).max(100).optional(),
    responsibleId: uuidSchema.optional(),
    underSiteId: uuidSchema.optional(),
    noSite: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  })
  .strict()
  .refine(periodIsSane, PERIOD_MESSAGE)
  .refine((value) => value.stepName === undefined || value.workflowId !== undefined, { message: 'A step is named within its workflow', path: ['workflowId'] })
  .refine((value) => !(value.noSite === true && (value.underSiteId !== undefined || value.siteId !== undefined)), { message: 'Without a site or under one, not both', path: ['noSite'] });
export type ReportTicketsFilters = z.infer<typeof reportTicketsFiltersSchema>;

/** The open tickets that are now at one step of a workflow (a row of the backlog). */
export const backlogTicketsFiltersSchema = z
  .object({ companyId: periodShape.companyId, workflowId: uuidSchema, stepName: z.string().trim().min(1).max(100), departmentId: periodShape.departmentId, siteId: periodShape.siteId, ...paging })
  .strict();
export type BacklogTicketsFilters = z.infer<typeof backlogTicketsFiltersSchema>;

export const REPORT_NAMES = [
  'summary',
  'sla-responsibles',
  'sla-steps',
  'ranking',
  'time-distribution',
  'incidents',
  'categories',
  'backlog',
  'user-detail',
  'sites',
  'heatmap',
  'tickets',
  'comments',
  'workflow-usage',
  'complete',
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export const exportReportNameSchema = z.enum(REPORT_NAMES);

/** The user whose detail is exported (`user-detail` only). */
export const userDetailExportSchema = z.object({ userId: uuidSchema });
