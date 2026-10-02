/** Minutes are business minutes the engine stored (net of incident pauses); percentages have one decimal; `null` means "nothing to measure". */
export type Minutes = number | null;

export interface DistributionStats {
  readonly min: Minutes;
  readonly p25: Minutes;
  readonly median: Minutes;
  readonly p75: Minutes;
  readonly p90: Minutes;
  readonly max: Minutes;
}

export interface SummaryReport {
  readonly timeZones: readonly string[];
  readonly created: number;
  readonly closed: number;
  readonly open: number;
  /** Step total (the visit): on time among the visits that ended in the period and had an SLA. */
  readonly stepOnTimePct: number | null;
  /** Each responsible's own clock. */
  readonly responsibleOnTimePct: number | null;
  readonly avgResolutionMin: Minutes;
  readonly medianResolutionMin: Minutes;
  /** Closed tickets left out of the resolution time (no visits or no calendar). */
  readonly unmeasuredTickets: number;
}

export interface ResponsibleSlaRow {
  /** `null`: the clock of a pool nobody took. */
  readonly userId: string | null;
  readonly name: string | null;
  readonly clocks: number;
  readonly onTime: number;
  readonly late: number;
  readonly noSla: number;
  readonly compliancePct: number | null;
  readonly avgMin: Minutes;
  readonly medianMin: Minutes;
  readonly avgPausedMin: Minutes;
}

export interface StepSlaRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly visits: number;
  readonly onTime: number;
  readonly late: number;
  readonly noSla: number;
  readonly compliancePct: number | null;
  readonly avgMin: Minutes;
  readonly medianMin: Minutes;
  readonly p90Min: Minutes;
  readonly avgPausedMin: Minutes;
  /** Visits that were a return or a reopening (loop above 1). */
  readonly reprocesses: number;
}

export interface RankingRow {
  readonly rank: number | null;
  readonly userId: string;
  readonly name: string;
  readonly delivered: number;
  readonly onTime: number;
  readonly late: number;
  readonly errors: number;
  /** Compliance C = on time / (on time + late). */
  readonly compliance: number | null;
  /** Quality Q = max(0, 1 - errors / delivered). */
  readonly quality: number | null;
  /** 100 × C × Q. */
  readonly score: number | null;
  readonly medianMin: Minutes;
}

export interface RankingReport {
  readonly minVolume: number;
  readonly ranked: readonly RankingRow[];
  /** Below the minimum volume: shown without a position. */
  readonly unranked: readonly RankingRow[];
}

export interface StepDistributionRow extends DistributionStats {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly visits: number;
}

export interface WorkflowDistributionRow extends DistributionStats {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly tickets: number;
}

export interface TimeDistributionReport {
  readonly byStep: readonly StepDistributionRow[];
  readonly byWorkflow: readonly WorkflowDistributionRow[];
}

export interface IncidentGroupRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly open: number;
  readonly resolved: number;
  readonly avgPausedMin: Minutes;
  readonly medianPausedMin: Minutes;
}

export interface IncidentsReport {
  readonly byStep: readonly IncidentGroupRow[];
  readonly byOpener: readonly IncidentGroupRow[];
  readonly byAssignee: readonly IncidentGroupRow[];
}

export interface CategoryRow {
  readonly categoryId: string;
  readonly categoryName: string;
  /** `null` on the row that adds up a whole category. */
  readonly subcategoryId: string | null;
  readonly subcategoryName: string | null;
  readonly created: number;
  readonly open: number;
  readonly closed: number;
  readonly avgResolutionMin: Minutes;
}

export interface BacklogRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly open: number;
  readonly paused: number;
  readonly overdue: number;
  readonly avgAgeDays: number | null;
  readonly maxAgeDays: number | null;
  readonly avgHoursInStep: number | null;
  /** Tickets by calendar age: up to 1 day, up to 3, up to 7, more. */
  readonly ageBuckets: readonly [number, number, number, number];
}

export interface BacklogReport {
  readonly asOf: string;
  readonly rows: readonly BacklogRow[];
}

export interface UserClockRow {
  readonly ticketNumber: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly loop: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly dueAt: string | null;
  readonly businessMin: Minutes;
  readonly pausedMin: number;
  readonly result: 'ON_TIME' | 'LATE' | null;
}

export interface UserDetailReport {
  readonly userId: string;
  readonly name: string | null;
  readonly summary: RankingRow | null;
  readonly clocks: { readonly items: readonly UserClockRow[]; readonly page: number; readonly pageSize: number; readonly total: number };
}

/** Every sheet-able report, to export. */
export type ReportData = SummaryReport | readonly ResponsibleSlaRow[] | readonly StepSlaRow[] | RankingReport | TimeDistributionReport | IncidentsReport | readonly CategoryRow[] | BacklogReport | UserDetailReport;
