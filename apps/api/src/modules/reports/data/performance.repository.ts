import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, NOT_CANCELLED_SIGNATURE, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

export interface CountsRow {
  readonly created: number;
  readonly closed: number;
  readonly open: number;
}
export interface ResultCounts {
  readonly onTime: number;
  readonly late: number;
}
export interface ResolutionStats {
  readonly unmeasured: number;
  readonly avg: number | null;
  readonly median: number | null;
}
export interface ClockStatsRow {
  readonly userId: string | null;
  readonly name: string | null;
  readonly clocks: number;
  readonly delivered: number;
  readonly onTime: number;
  readonly late: number;
  /** On time, but handed over to somebody else: not a delivery. */
  readonly handedOff: number;
  readonly noSla: number;
  readonly avg: number | null;
  readonly median: number | null;
  readonly avgPaused: number | null;
}
export interface VisitStatsRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly visits: number;
  readonly onTime: number;
  readonly late: number;
  readonly noSla: number;
  readonly avg: number | null;
  readonly min: number | null;
  readonly p25: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly max: number | null;
  readonly avgPaused: number | null;
  readonly reprocesses: number;
}
export interface WorkflowResolutionRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly tickets: number;
  readonly min: number | null;
  readonly p25: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}
export interface ErrorCountRow {
  readonly userId: string;
  readonly name: string;
  readonly errors: number;
}

/** Closed tickets of the period with the business minutes they spent with people (the sum of their visits). */
const resolutionTimes = (query: ReportQuery): Prisma.Sql => sql`
  closed AS (
    SELECT t.id, t.workflow_id FROM ${TICKET_JOIN}
    WHERE ${ticketPredicate(query)} AND t.status = 'CLOSED' AND t.closed_at IS NOT NULL AND ${inCoarsePeriod(sql`t.closed_at`, query)} AND ${inPeriod(sql`t.closed_at`, query)}
  ),
  per_ticket AS (
    SELECT cl.id, cl.workflow_id, sum(v.business_minutes)::int AS minutes, count(v.id)::int AS visits, bool_or(v.business_minutes IS NULL) AS has_null
    FROM closed cl LEFT JOIN ticket_step_visits v ON v.tenant_id = ${query.tenantId}::uuid AND v.ticket_id = cl.id
    GROUP BY cl.id, cl.workflow_id
  )`;

const MEASURED = sql`visits > 0 AND NOT has_null`;

/** Clocks that ended in the period, with the ticket and company they belong to. */
const CLOCKS = sql`ticket_sla_clocks k JOIN ${TICKET_JOIN} ON t.tenant_id = k.tenant_id AND t.id = k.ticket_id`;

@Injectable()
export class PerformanceRepository {
  async counts(tx: TenantTransaction, query: ReportQuery): Promise<CountsRow> {
    const [row] = await tx.$queryRaw<CountsRow[]>`
      SELECT
        (count(*) FILTER (WHERE ${inPeriod(sql`t.created_at`, query)}))::int AS created,
        (count(*) FILTER (WHERE t.status = 'CLOSED' AND t.closed_at IS NOT NULL AND ${inPeriod(sql`t.closed_at`, query)}))::int AS closed,
        (count(*) FILTER (WHERE ${inPeriod(sql`t.created_at`, query)} AND t.status IN ('OPEN', 'PAUSED')))::int AS open
      FROM ${TICKET_JOIN}
      WHERE ${ticketPredicate(query)} AND (${inCoarsePeriod(sql`t.created_at`, query)} OR ${inCoarsePeriod(sql`t.closed_at`, query)})`;
    return row!;
  }

  async visitResults(tx: TenantTransaction, query: ReportQuery): Promise<ResultCounts> {
    const [row] = await tx.$queryRaw<ResultCounts[]>`
      SELECT (count(*) FILTER (WHERE v.result = 'ON_TIME'))::int AS "onTime", (count(*) FILTER (WHERE v.result = 'LATE'))::int AS late
      FROM ticket_step_visits v JOIN ${TICKET_JOIN} ON t.tenant_id = v.tenant_id AND t.id = v.ticket_id
      WHERE ${ticketPredicate(query)} AND v.tenant_id = ${query.tenantId}::uuid AND v.exited_at IS NOT NULL AND ${inCoarsePeriod(sql`v.exited_at`, query)} AND ${inPeriod(sql`v.exited_at`, query)}`;
    return row!;
  }

  async clockResults(tx: TenantTransaction, query: ReportQuery): Promise<ResultCounts> {
    const [row] = await tx.$queryRaw<ResultCounts[]>`
      SELECT (count(*) FILTER (WHERE k.result = 'ON_TIME' AND k.completion_reason <> 'REASSIGNED'))::int AS "onTime", (count(*) FILTER (WHERE k.result = 'LATE'))::int AS late
      FROM ${CLOCKS}
      WHERE ${ticketPredicate(query)} AND k.tenant_id = ${query.tenantId}::uuid AND k.completed_at IS NOT NULL AND ${inCoarsePeriod(sql`k.completed_at`, query)} AND ${inPeriod(sql`k.completed_at`, query)}
        AND ${NOT_CANCELLED_SIGNATURE}`;
    return row!;
  }

  async resolution(tx: TenantTransaction, query: ReportQuery): Promise<ResolutionStats> {
    const [row] = await tx.$queryRaw<ResolutionStats[]>`
      WITH ${resolutionTimes(query)}
      SELECT (count(*) FILTER (WHERE NOT (${MEASURED})))::int AS unmeasured,
        (avg(minutes) FILTER (WHERE ${MEASURED}))::float8 AS avg,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) FILTER (WHERE ${MEASURED}))::float8 AS median
      FROM per_ticket`;
    return row!;
  }

  async resolutionByWorkflow(tx: TenantTransaction, query: ReportQuery): Promise<WorkflowResolutionRow[]> {
    return tx.$queryRaw<WorkflowResolutionRow[]>`
      WITH ${resolutionTimes(query)}
      SELECT p.workflow_id::text AS "workflowId", w.name AS "workflowName", count(*)::int AS tickets,
        (min(minutes))::float8 AS min,
        (percentile_cont(0.25) WITHIN GROUP (ORDER BY minutes))::float8 AS p25,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes))::float8 AS median,
        (percentile_cont(0.75) WITHIN GROUP (ORDER BY minutes))::float8 AS p75,
        (percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes))::float8 AS p90,
        (max(minutes))::float8 AS max
      FROM per_ticket p JOIN workflows w ON w.tenant_id = ${query.tenantId}::uuid AND w.id = p.workflow_id
      WHERE ${MEASURED}
      GROUP BY p.workflow_id, w.name
      ORDER BY w.name, p.workflow_id`;
  }

  /** One row per responsible (and one for the pool nobody took): the clocks that ended in the period. */
  async clockStats(tx: TenantTransaction, query: ReportQuery, responsibleId?: string): Promise<ClockStatsRow[]> {
    const only = responsibleId === undefined ? sql`TRUE` : sql`k.responsible_id = ${responsibleId}::uuid`;
    return tx.$queryRaw<ClockStatsRow[]>`
      SELECT k.responsible_id::text AS "userId", max(u.first_name || ' ' || u.last_name) AS name,
        count(*)::int AS clocks, (count(DISTINCT k.ticket_id) FILTER (WHERE k.completion_reason <> 'REASSIGNED'))::int AS delivered,
        (count(*) FILTER (WHERE k.result = 'ON_TIME' AND k.completion_reason <> 'REASSIGNED'))::int AS "onTime", (count(*) FILTER (WHERE k.result = 'LATE'))::int AS late,
        (count(*) FILTER (WHERE k.result = 'ON_TIME' AND k.completion_reason = 'REASSIGNED'))::int AS "handedOff",
        (count(*) FILTER (WHERE k.result IS NULL))::int AS "noSla",
        (avg(k.business_minutes))::float8 AS avg,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY k.business_minutes))::float8 AS median,
        (avg(k.paused_minutes))::float8 AS "avgPaused"
      FROM ${CLOCKS}
      LEFT JOIN memberships m ON m.tenant_id = k.tenant_id AND m.user_id = k.responsible_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${ticketPredicate(query)} AND k.tenant_id = ${query.tenantId}::uuid AND k.completed_at IS NOT NULL AND ${inCoarsePeriod(sql`k.completed_at`, query)} AND ${inPeriod(sql`k.completed_at`, query)}
        AND ${NOT_CANCELLED_SIGNATURE} AND ${only}
      GROUP BY k.responsible_id
      ORDER BY clocks DESC, k.responsible_id`;
  }

  /** One row per workflow and step name: the visits (the step as a whole) that ended in the period. */
  async visitStats(tx: TenantTransaction, query: ReportQuery): Promise<VisitStatsRow[]> {
    return tx.$queryRaw<VisitStatsRow[]>`
      SELECT w.id::text AS "workflowId", w.name AS "workflowName", s.name AS "stepName", count(*)::int AS visits,
        (count(*) FILTER (WHERE v.result = 'ON_TIME'))::int AS "onTime", (count(*) FILTER (WHERE v.result = 'LATE'))::int AS late,
        (count(*) FILTER (WHERE v.result IS NULL))::int AS "noSla",
        (avg(v.business_minutes))::float8 AS avg, (min(v.business_minutes))::float8 AS min,
        (percentile_cont(0.25) WITHIN GROUP (ORDER BY v.business_minutes))::float8 AS p25,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY v.business_minutes))::float8 AS median,
        (percentile_cont(0.75) WITHIN GROUP (ORDER BY v.business_minutes))::float8 AS p75,
        (percentile_cont(0.9) WITHIN GROUP (ORDER BY v.business_minutes))::float8 AS p90,
        (max(v.business_minutes))::float8 AS max,
        (avg(v.paused_minutes))::float8 AS "avgPaused",
        (count(*) FILTER (WHERE v.loop > 1))::int AS reprocesses
      FROM ticket_step_visits v
      JOIN ${TICKET_JOIN} ON t.tenant_id = v.tenant_id AND t.id = v.ticket_id
      JOIN steps s ON s.tenant_id = v.tenant_id AND s.id = v.step_id
      JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
      WHERE ${ticketPredicate(query)} AND v.tenant_id = ${query.tenantId}::uuid AND v.exited_at IS NOT NULL AND ${inCoarsePeriod(sql`v.exited_at`, query)} AND ${inPeriod(sql`v.exited_at`, query)}
      GROUP BY w.id, w.name, s.name
      ORDER BY w.name, s.name, w.id`;
  }

  /** Reopenings blamed on each person in the period (an error of the process is nobody's). */
  async reopeningErrors(tx: TenantTransaction, query: ReportQuery, responsibleId?: string): Promise<ErrorCountRow[]> {
    const only = responsibleId === undefined ? sql`TRUE` : sql`e.responsible_id = ${responsibleId}::uuid`;
    return tx.$queryRaw<ErrorCountRow[]>`
      SELECT e.responsible_id::text AS "userId", max(u.first_name || ' ' || u.last_name) AS name, count(*)::int AS errors
      FROM ticket_errors e
      JOIN error_types et ON et.tenant_id = e.tenant_id AND et.id = e.error_type_id
      JOIN ${TICKET_JOIN} ON t.tenant_id = e.tenant_id AND t.id = e.ticket_id
      LEFT JOIN memberships m ON m.tenant_id = e.tenant_id AND m.user_id = e.responsible_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${ticketPredicate(query)} AND e.tenant_id = ${query.tenantId}::uuid AND et.is_reopening AND NOT e.is_process_error
        AND ${inCoarsePeriod(sql`e.created_at`, query)} AND ${inPeriod(sql`e.created_at`, query)} AND ${only}
      GROUP BY e.responsible_id`;
  }

  async timeZones(tx: TenantTransaction, tenantId: string, companyId?: string): Promise<string[]> {
    const rows = await tx.company.findMany({ where: { tenantId, ...(companyId === undefined ? {} : { id: companyId }) }, select: { timeZone: true }, distinct: ['timeZone'], orderBy: { timeZone: 'asc' } });
    return rows.map((row) => row.timeZone);
  }
}
