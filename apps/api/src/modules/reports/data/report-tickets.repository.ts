import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, NOT_CANCELLED_SIGNATURE, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

/** What narrows the tickets behind a number, besides the report's own filters. */
export interface TicketDrill {
  readonly categoryId?: string | undefined;
  readonly subcategoryId?: string | undefined;
  readonly stepName?: string | undefined;
  readonly responsibleId?: string | undefined;
  readonly underSiteId?: string | undefined;
  readonly noSite?: boolean | undefined;
}

export interface TicketListRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly workflowName: string;
  readonly categoryName: string | null;
  readonly subcategoryName: string | null;
  readonly currentStepName: string | null;
  readonly siteName: string | null;
  readonly creatorName: string | null;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface BacklogTicketStatsRow {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED';
  readonly assigneeNames: string[];
  readonly siteName: string | null;
  readonly createdAt: Date;
  readonly enteredStepAt: Date | null;
  readonly ageDays: number;
  readonly overdue: boolean;
}

export interface CommentRow {
  readonly ticketNumber: string;
  readonly workflowName: string;
  readonly stepName: string | null;
  readonly authorName: string | null;
  readonly createdAt: Date;
  readonly commentHtml: string;
}

export interface WorkflowUsageRow {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly isActive: boolean;
  readonly created: number;
  readonly open: number;
  readonly closed: number;
  readonly lastCreatedAt: Date | null;
}

/** The narrowing as conditions on ticket `t` (and its subcategory `sub`), within the period. */
function drillSql(query: ReportQuery, drill: TicketDrill): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (drill.categoryId !== undefined) parts.push(sql`sub.category_id = ${drill.categoryId}::uuid`);
  if (drill.subcategoryId !== undefined) parts.push(sql`t.subcategory_id = ${drill.subcategoryId}::uuid`);
  if (drill.noSite === true) parts.push(sql`t.site_id IS NULL`);
  if (drill.underSiteId !== undefined) {
    parts.push(sql`t.site_id IN (
      WITH RECURSIVE below AS (
        SELECT id FROM sites WHERE tenant_id = ${query.tenantId}::uuid AND id = ${drill.underSiteId}::uuid
        UNION ALL SELECT s.id FROM sites s JOIN below b ON s.parent_id = b.id WHERE s.tenant_id = ${query.tenantId}::uuid
      ) SELECT id FROM below)`);
  }
  if (drill.stepName !== undefined) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM ticket_step_visits v JOIN steps s ON s.tenant_id = v.tenant_id AND s.id = v.step_id
      WHERE v.tenant_id = t.tenant_id AND v.ticket_id = t.id AND s.name = ${drill.stepName} AND v.exited_at IS NOT NULL
        AND ${inCoarsePeriod(sql`v.exited_at`, query)} AND ${inPeriod(sql`v.exited_at`, query)})`);
  }
  if (drill.responsibleId !== undefined) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM ticket_sla_clocks k
      WHERE k.tenant_id = t.tenant_id AND k.ticket_id = t.id AND k.responsible_id = ${drill.responsibleId}::uuid AND k.completed_at IS NOT NULL
        AND ${inCoarsePeriod(sql`k.completed_at`, query)} AND ${inPeriod(sql`k.completed_at`, query)} AND ${NOT_CANCELLED_SIGNATURE})`);
  }
  // A list of tickets with nothing to tie it to a moment is the tickets created in the period.
  if (drill.stepName === undefined && drill.responsibleId === undefined) parts.push(sql`${inCoarsePeriod(sql`t.created_at`, query)} AND ${inPeriod(sql`t.created_at`, query)}`);
  return parts.length === 0 ? sql`TRUE` : Prisma.join(parts, ' AND ');
}

const TICKET_ROW_FROM = sql`
  FROM ${TICKET_JOIN}
  JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
  JOIN subcategories sub ON sub.tenant_id = t.tenant_id AND sub.id = t.subcategory_id
  JOIN categories cat ON cat.tenant_id = sub.tenant_id AND cat.id = sub.category_id
  LEFT JOIN steps cs ON cs.tenant_id = t.tenant_id AND cs.id = t.current_step_id
  LEFT JOIN sites st ON st.tenant_id = t.tenant_id AND st.id = t.site_id
  LEFT JOIN users cu ON cu.id = t.creator_id`;

const TICKET_ROW_COLUMNS = sql`
  t.id::text AS id, t.number::text AS number, t.title, t.status::text AS status, w.name AS "workflowName", cat.name AS "categoryName",
  sub.name AS "subcategoryName", cs.name AS "currentStepName", st.name AS "siteName", cu.first_name || ' ' || cu.last_name AS "creatorName",
  t.created_at AS "createdAt", t.closed_at AS "closedAt"`;

@Injectable()
export class ReportTicketsRepository {
  async tickets(tx: TenantTransaction, query: ReportQuery, drill: TicketDrill, window: { readonly offset: number; readonly limit: number }): Promise<{ rows: TicketListRow[]; total: number }> {
    const where = sql`${ticketPredicate(query)} AND ${drillSql(query, drill)}`;
    const rows = await tx.$queryRaw<TicketListRow[]>`
      SELECT ${TICKET_ROW_COLUMNS} ${TICKET_ROW_FROM}
      WHERE ${where}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    const [count] = await tx.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total ${TICKET_ROW_FROM} WHERE ${where}`;
    return { rows, total: count?.total ?? 0 };
  }

  /** The open tickets now at one step of a workflow, the oldest first. `now` is a parameter so tests can fix it. */
  async backlogTickets(tx: TenantTransaction, query: ReportQuery, stepName: string, now: Date, window: { readonly offset: number; readonly limit: number }): Promise<{ rows: BacklogTicketStatsRow[]; total: number }> {
    const from = sql`
      FROM ${TICKET_JOIN}
      JOIN ticket_step_visits v ON v.tenant_id = t.tenant_id AND v.ticket_id = t.id AND v.exited_at IS NULL
      JOIN steps s ON s.tenant_id = v.tenant_id AND s.id = v.step_id
      WHERE ${ticketPredicate(query)} AND t.status IN ('OPEN', 'PAUSED') AND s.name = ${stepName}`;
    const rows = await tx.$queryRaw<BacklogTicketStatsRow[]>`
      SELECT t.id::text AS id, t.number::text AS number, t.title, t.status::text AS status,
        coalesce((SELECT array_agg(u.first_name || ' ' || u.last_name ORDER BY u.first_name, u.last_name)
          FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.tenant_id = t.tenant_id AND a.ticket_id = t.id), '{}') AS "assigneeNames",
        (SELECT name FROM sites st WHERE st.tenant_id = t.tenant_id AND st.id = t.site_id) AS "siteName",
        t.created_at AS "createdAt", v.entered_at AS "enteredStepAt",
        (extract(epoch FROM (${now}::timestamptz - t.created_at)) / 86400)::float8 AS "ageDays",
        (t.status = 'OPEN' AND v.due_at IS NOT NULL AND v.due_at < ${now}) AS overdue
      ${from}
      ORDER BY t.created_at, t.id
      LIMIT ${window.limit} OFFSET ${window.offset}`;
    const [count] = await tx.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total ${from}`;
    return { rows, total: count?.total ?? 0 };
  }

  /** Comments written in the period (at most `limit`), oldest first. */
  async comments(tx: TenantTransaction, query: ReportQuery, limit: number): Promise<CommentRow[]> {
    return tx.$queryRaw<CommentRow[]>`
      SELECT t.number::text AS "ticketNumber", w.name AS "workflowName", s.name AS "stepName", u.first_name || ' ' || u.last_name AS "authorName",
        e.created_at AS "createdAt", e.comment_html AS "commentHtml"
      FROM ticket_events e
      JOIN ${TICKET_JOIN} ON t.tenant_id = e.tenant_id AND t.id = e.ticket_id
      JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
      LEFT JOIN steps s ON s.tenant_id = e.tenant_id AND s.id = e.step_id
      LEFT JOIN users u ON u.id = e.actor_id
      WHERE ${ticketPredicate(query)} AND e.tenant_id = ${query.tenantId}::uuid AND e.comment_html IS NOT NULL AND e.comment_html <> ''
        AND ${inCoarsePeriod(sql`e.created_at`, query)} AND ${inPeriod(sql`e.created_at`, query)}
      ORDER BY e.created_at, e.id
      LIMIT ${limit}`;
  }

  /**
   * Each workflow with the tickets created in the period: one without any is "not in use". Workflows nobody created a
   * ticket of are listed only for a member who sees every ticket (a narrower scope says nothing about them).
   */
  async workflowUsage(tx: TenantTransaction, query: ReportQuery): Promise<WorkflowUsageRow[]> {
    const allWorkflows = query.scope.kind === 'all';
    return tx.$queryRaw<WorkflowUsageRow[]>`
      WITH used AS (
        SELECT t.workflow_id, count(*)::int AS created,
          (count(*) FILTER (WHERE t.status IN ('OPEN', 'PAUSED')))::int AS open,
          (count(*) FILTER (WHERE t.status = 'CLOSED'))::int AS closed,
          max(t.created_at) AS last_created_at
        FROM ${TICKET_JOIN}
        WHERE ${ticketPredicate(query)} AND ${inCoarsePeriod(sql`t.created_at`, query)} AND ${inPeriod(sql`t.created_at`, query)}
        GROUP BY t.workflow_id
      )
      SELECT w.id::text AS "workflowId", w.name AS "workflowName", w.is_active AS "isActive",
        coalesce(u.created, 0)::int AS created, coalesce(u.open, 0)::int AS open, coalesce(u.closed, 0)::int AS closed, u.last_created_at AS "lastCreatedAt"
      FROM workflows w LEFT JOIN used u ON u.workflow_id = w.id
      WHERE w.tenant_id = ${query.tenantId}::uuid AND (u.workflow_id IS NOT NULL OR ${allWorkflows})
        AND (${query.workflowId ?? null}::uuid IS NULL OR w.id = ${query.workflowId ?? null}::uuid)
      ORDER BY coalesce(u.created, 0) DESC, w.name, w.id`;
  }
}
