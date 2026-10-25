import type {
  BacklogReport,
  BacklogTicketRow,
  CategoryRow,
  HeatmapReport,
  IncidentsReport,
  RankingReport,
  ReportName,
  ReportTicketRow,
  ResponsibleSlaRow,
  SiteReport,
  StepSlaRow,
  SummaryReport,
  TimeDistributionReport,
  UserDetailReport,
} from '@procesabpm/shared';
import { pageResponseSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { saveBlob } from '@/shared/lib/save-blob';
import type { ReportFilters } from '../lib/report-filters';

const minutes = z.number().nullable();
const pctValue = z.number().nullable();
const count = z.number().int();

const summarySchema = z.object({
  timeZones: z.array(z.string()),
  created: count,
  closed: count,
  open: count,
  stepOnTimePct: pctValue,
  responsibleOnTimePct: pctValue,
  avgResolutionMin: minutes,
  medianResolutionMin: minutes,
  unmeasuredTickets: count,
}) satisfies z.ZodType<SummaryReport>;

const responsibleSchema = z.object({
  userId: z.string().nullable(),
  name: z.string().nullable(),
  clocks: count,
  onTime: count,
  late: count,
  handedOff: count,
  noSla: count,
  compliancePct: pctValue,
  avgMin: minutes,
  medianMin: minutes,
  avgPausedMin: minutes,
}) satisfies z.ZodType<ResponsibleSlaRow>;

const stepSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  stepName: z.string(),
  visits: count,
  onTime: count,
  late: count,
  noSla: count,
  compliancePct: pctValue,
  avgMin: minutes,
  medianMin: minutes,
  p90Min: minutes,
  avgPausedMin: minutes,
  reprocesses: count,
}) satisfies z.ZodType<StepSlaRow>;

const rankingRowSchema = z.object({
  rank: z.number().int().nullable(),
  userId: z.string(),
  name: z.string(),
  delivered: count,
  handled: count,
  onTime: count,
  late: count,
  errors: count,
  compliance: z.number().nullable(),
  quality: z.number().nullable(),
  score: z.number().nullable(),
  weighted: z.number().nullable(),
  classification: z.enum(['GREEN', 'YELLOW', 'RED']).nullable(),
  medianMin: minutes,
});
const rankingSchema = z.object({ minVolume: count, ranked: z.array(rankingRowSchema), unranked: z.array(rankingRowSchema) }) satisfies z.ZodType<RankingReport>;

const stats = { min: minutes, p25: minutes, median: minutes, p75: minutes, p90: minutes, max: minutes };
const distributionSchema = z.object({
  byStep: z.array(z.object({ workflowId: z.string(), workflowName: z.string(), stepName: z.string(), visits: count, ...stats })),
  byWorkflow: z.array(z.object({ workflowId: z.string(), workflowName: z.string(), tickets: count, ...stats })),
}) satisfies z.ZodType<TimeDistributionReport>;

const incidentGroup = z.object({ key: z.string(), label: z.string(), count, open: count, resolved: count, avgPausedMin: minutes, medianPausedMin: minutes });
const incidentsSchema = z.object({ byStep: z.array(incidentGroup), byOpener: z.array(incidentGroup), byAssignee: z.array(incidentGroup) }) satisfies z.ZodType<IncidentsReport>;

const categorySchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  subcategoryId: z.string().nullable(),
  subcategoryName: z.string().nullable(),
  created: count,
  open: count,
  closed: count,
  avgResolutionMin: minutes,
}) satisfies z.ZodType<CategoryRow>;

const backlogSchema = z.object({
  asOf: z.string(),
  rows: z.array(
    z.object({
      workflowId: z.string(),
      workflowName: z.string(),
      stepName: z.string(),
      open: count,
      paused: count,
      overdue: count,
      avgAgeDays: z.number().nullable(),
      maxAgeDays: z.number().nullable(),
      avgHoursInStep: z.number().nullable(),
      ageBuckets: z.tuple([count, count, count, count]),
    }),
  ),
}) satisfies z.ZodType<BacklogReport>;

const siteSchema = z.object({
  level: count,
  targetPct: z.number(),
  rows: z.array(
    z.object({
      siteId: z.string().nullable(),
      siteName: z.string().nullable(),
      tickets: count,
      responsibles: count,
      delivered: count,
      onTime: count,
      late: count,
      compliancePct: pctValue,
      processErrors: count,
      otherErrors: count,
      errorPct: pctValue,
      avgMin: minutes,
    }),
  ),
}) satisfies z.ZodType<SiteReport>;

const heatmapSchema = z.object({
  level: count,
  sites: z.array(
    z.object({
      siteId: z.string().nullable(),
      siteName: z.string().nullable(),
      avgMin: minutes,
      users: z.array(z.object({ userId: z.string(), name: z.string().nullable(), delivered: count, processErrors: count, otherErrors: count, avgMin: minutes, vsPeersPct: z.number().nullable() })),
    }),
  ),
}) satisfies z.ZodType<HeatmapReport>;

const ticketRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED']),
  workflowName: z.string(),
  categoryName: z.string().nullable(),
  subcategoryName: z.string().nullable(),
  currentStepName: z.string().nullable(),
  siteName: z.string().nullable(),
  creatorName: z.string().nullable(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
}) satisfies z.ZodType<ReportTicketRow>;

const backlogTicketSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string(),
  status: z.enum(['OPEN', 'PAUSED']),
  assigneeNames: z.array(z.string()),
  siteName: z.string().nullable(),
  createdAt: z.string(),
  enteredStepAt: z.string().nullable(),
  ageDays: count,
  overdue: z.boolean(),
}) satisfies z.ZodType<BacklogTicketRow>;

const userDetailSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  summary: rankingRowSchema.nullable(),
  clocks: z.object({
    items: z.array(
      z.object({
        ticketNumber: z.string(),
        workflowName: z.string(),
        stepName: z.string(),
        loop: count,
        startedAt: z.string(),
        completedAt: z.string().nullable(),
        dueAt: z.string().nullable(),
        businessMin: minutes,
        pausedMin: count,
        result: z.enum(['ON_TIME', 'LATE']).nullable(),
        completionReason: z.string().nullable(),
      }),
    ),
    page: count,
    pageSize: count,
    total: count,
  }),
}) satisfies z.ZodType<UserDetailReport>;

const workflowOptionSchema = z.object({ id: z.string(), name: z.string() });

export type SiteReportData = z.infer<typeof siteSchema>;
export type HeatmapData = z.infer<typeof heatmapSchema>;
export type ReportTicket = z.infer<typeof ticketRowSchema>;
export type BacklogTicket = z.infer<typeof backlogTicketSchema>;
export type RankingData = z.infer<typeof rankingSchema>;
export type RankingRow = z.infer<typeof rankingRowSchema>;

/** The filters every report shares, as the API reads them (no empty values). */
export function filterParams(filters: ReportFilters, extra: Readonly<Record<string, string | number | undefined>> = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) if (value !== undefined && value !== '') params.set(key, String(value));
  return params;
}

/** The backlog is a snapshot of now: it takes no period. */
const withoutPeriod = (filters: ReportFilters): ReportFilters => ({ ...filters, from: '', to: '' });

export const reportQueryKeys = {
  all: ['reports'] as const,
  report: (name: string, params: string) => ['reports', name, params] as const,
};

function report<T>(client: HttpClient, name: string, path: string, params: URLSearchParams, schema: z.ZodType<T>) {
  const query = params.toString();
  return queryOptions({
    queryKey: reportQueryKeys.report(name, query),
    queryFn: ({ signal }) => client.request(`/reports/${path}?${query}`, { schema, signal }),
    placeholderData: keepPreviousData,
  });
}

export const summaryQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'summary', 'summary', filterParams(filters), summarySchema);
export const responsiblesQuery = (client: HttpClient, filters: ReportFilters, page: number) => report(client, 'responsibles', 'sla/responsibles', filterParams(filters, { page, pageSize: 25 }), pageResponseSchema(responsibleSchema));
export const stepsQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'steps', 'sla/steps', filterParams(filters), z.array(stepSchema));
export const rankingQuery = (client: HttpClient, filters: ReportFilters, minVolume: number) => report(client, 'ranking', 'ranking', filterParams(filters, { minVolume }), rankingSchema);
export const distributionQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'distribution', 'time-distribution', filterParams(filters), distributionSchema);
export const incidentsQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'incidents', 'incidents', filterParams(filters), incidentsSchema);
export const categoriesQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'categories', 'categories', filterParams(filters), z.array(categorySchema));
export const backlogQuery = (client: HttpClient, filters: ReportFilters) => report(client, 'backlog', 'backlog', filterParams(withoutPeriod(filters)), backlogSchema);
export const sitesQuery = (client: HttpClient, filters: ReportFilters, level: number) => report(client, 'sites', 'sites', filterParams(filters, { level }), siteSchema);
export const heatmapQuery = (client: HttpClient, filters: ReportFilters, level: number) => report(client, 'heatmap', 'heatmap', filterParams(filters, { level }), heatmapSchema);
export const userDetailQuery = (client: HttpClient, filters: ReportFilters, userId: string, page: number) =>
  report(client, 'user', `users/${encodeURIComponent(userId)}`, filterParams(filters, { page, pageSize: 25 }), userDetailSchema);

/** What narrows a list of tickets behind a number (the API's `GET /reports/tickets`). */
export interface TicketDrill {
  readonly categoryId?: string;
  readonly subcategoryId?: string;
  readonly workflowId?: string;
  readonly stepName?: string;
  readonly responsibleId?: string;
  readonly underSiteId?: string;
  readonly noSite?: 'true';
}

export const reportTicketsQuery = (client: HttpClient, filters: ReportFilters, drill: TicketDrill, page: number) =>
  report(client, 'tickets', 'tickets', filterParams(filters, { ...drill, page, pageSize: 25 }), pageResponseSchema(ticketRowSchema));

export const backlogTicketsQuery = (client: HttpClient, filters: ReportFilters, workflowId: string, stepName: string, page: number) =>
  report(client, 'backlog-tickets', 'backlog/tickets', filterParams(withoutPeriod(filters), { workflowId, stepName, page, pageSize: 25 }), pageResponseSchema(backlogTicketSchema));

/** The workflows to filter by: every one, the inactive too (their tickets are still in the reports). */
export function workflowOptionsQuery(client: HttpClient) {
  return queryOptions({
    queryKey: ['reports', 'workflow-options'] as const,
    queryFn: ({ signal }) => client.request('/workflows?pageSize=100&includeInactive=true', { schema: pageResponseSchema(workflowOptionSchema), signal }),
    select: (page) => page.items,
  });
}

/** Downloads a report as a workbook: it travels with the session, so it is fetched and then saved. */
export async function downloadReport(client: HttpClient, name: ReportName, params: URLSearchParams): Promise<void> {
  const blob = await client.request(`/reports/${name}/export?${params.toString()}`, { responseType: 'blob' });
  saveBlob(blob, `reporte-${name}.xlsx`);
}
