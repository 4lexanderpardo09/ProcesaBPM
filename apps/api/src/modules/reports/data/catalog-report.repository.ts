import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

export interface CategoryStatsRow {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly subcategoryId: string;
  readonly subcategoryName: string;
  readonly created: number;
  readonly open: number;
  readonly closed: number;
  /** Sum of the resolution minutes of the closed tickets that could be measured, and how many they were. */
  readonly resolutionSum: number;
  readonly resolutionCount: number;
}

export interface BacklogStatsRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly open: number;
  readonly paused: number;
  readonly overdue: number;
  readonly avgAgeDays: number | null;
  readonly maxAgeDays: number | null;
  readonly avgHoursInStep: number | null;
  readonly ageBuckets: number[];
}

@Injectable()
export class CatalogReportRepository {
  async categories(tx: TenantTransaction, query: ReportQuery): Promise<CategoryStatsRow[]> {
    return tx.$queryRaw<CategoryStatsRow[]>`
      SELECT cat.id::text AS "categoryId", cat.name AS "categoryName", sub.id::text AS "subcategoryId", sub.name AS "subcategoryName",
        count(*)::int AS created,
        (count(*) FILTER (WHERE t.status IN ('OPEN', 'PAUSED')))::int AS open,
        (count(*) FILTER (WHERE t.status = 'CLOSED'))::int AS closed,
        coalesce(sum(r.minutes) FILTER (WHERE t.status = 'CLOSED' AND r.visits > 0 AND NOT r.has_null), 0)::float8 AS "resolutionSum",
        (count(*) FILTER (WHERE t.status = 'CLOSED' AND r.visits > 0 AND NOT r.has_null))::int AS "resolutionCount"
      FROM ${TICKET_JOIN}
      JOIN subcategories sub ON sub.tenant_id = t.tenant_id AND sub.id = t.subcategory_id
      JOIN categories cat ON cat.tenant_id = sub.tenant_id AND cat.id = sub.category_id
      LEFT JOIN LATERAL (
        SELECT sum(v.business_minutes) AS minutes, count(v.id) AS visits, bool_or(v.business_minutes IS NULL) AS has_null
        FROM ticket_step_visits v WHERE v.tenant_id = t.tenant_id AND v.ticket_id = t.id
      ) r ON t.status = 'CLOSED'
      WHERE ${ticketPredicate(query)} AND ${inCoarsePeriod(sql`t.created_at`, query)} AND ${inPeriod(sql`t.created_at`, query)}
      GROUP BY cat.id, cat.name, sub.id, sub.name
      ORDER BY cat.name, sub.name, sub.id`;
  }

  /** Tickets not closed now, by workflow and the step they are in. `now` is a parameter so tests can fix it. */
  async backlog(tx: TenantTransaction, query: ReportQuery, now: Date): Promise<BacklogStatsRow[]> {
    return tx.$queryRaw<BacklogStatsRow[]>`
      SELECT w.id::text AS "workflowId", w.name AS "workflowName", s.name AS "stepName",
        (count(*) FILTER (WHERE t.status = 'OPEN'))::int AS open,
        (count(*) FILTER (WHERE t.status = 'PAUSED'))::int AS paused,
        (count(*) FILTER (WHERE t.status = 'OPEN' AND v.due_at IS NOT NULL AND v.due_at < ${now}))::int AS overdue,
        (avg(extract(epoch FROM (${now}::timestamptz - t.created_at)) / 86400))::float8 AS "avgAgeDays",
        (max(extract(epoch FROM (${now}::timestamptz - t.created_at)) / 86400))::float8 AS "maxAgeDays",
        (avg(extract(epoch FROM (${now}::timestamptz - v.entered_at)) / 3600))::float8 AS "avgHoursInStep",
        ARRAY[
          (count(*) FILTER (WHERE ${now}::timestamptz - t.created_at <= interval '1 day'))::int,
          (count(*) FILTER (WHERE ${now}::timestamptz - t.created_at > interval '1 day' AND ${now}::timestamptz - t.created_at <= interval '3 days'))::int,
          (count(*) FILTER (WHERE ${now}::timestamptz - t.created_at > interval '3 days' AND ${now}::timestamptz - t.created_at <= interval '7 days'))::int,
          (count(*) FILTER (WHERE ${now}::timestamptz - t.created_at > interval '7 days'))::int
        ] AS "ageBuckets"
      FROM ${TICKET_JOIN}
      JOIN ticket_step_visits v ON v.tenant_id = t.tenant_id AND v.ticket_id = t.id AND v.exited_at IS NULL
      JOIN steps s ON s.tenant_id = v.tenant_id AND s.id = v.step_id
      JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
      WHERE ${ticketPredicate(query)} AND t.status IN ('OPEN', 'PAUSED')
      GROUP BY w.id, w.name, s.name
      ORDER BY w.name, s.name, w.id`;
  }
}
