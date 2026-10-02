import { Prisma } from '@procesabpm/db';
import type { PeriodBounds } from '../domain/report-period.js';
import type { ReportScopeField, ScopePredicate, ScopeSpec } from '../domain/report-scope.js';

const { sql } = Prisma;

/** What every report query is asked: the tenant, the filters, the period and what the member may see. */
export interface ReportQuery {
  readonly tenantId: string;
  readonly period: PeriodBounds;
  readonly companyId?: string | undefined;
  readonly workflowId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly siteId?: string | undefined;
  readonly scope: ScopeSpec;
}

/**
 * Field names never reach SQL as text: they select one of these fragments. Every report joins the ticket as `t`
 * and its company as `c`.
 */
const COLUMNS: Readonly<Record<ReportScopeField, Prisma.Sql>> = {
  companyId: sql`t.company_id`,
  departmentId: sql`t.department_id`,
  siteId: sql`t.site_id`,
  workflowId: sql`t.workflow_id`,
};

function predicateSql({ field, op, values }: ScopePredicate): Prisma.Sql {
  const column = COLUMNS[field];
  switch (op) {
    case 'eq':
      return sql`${column} = ${values[0]!}::uuid`;
    case 'in':
      return sql`${column} = ANY(${values as string[]}::uuid[])`;
    case 'neq':
      return sql`${column} <> ${values[0]!}::uuid`;
    case 'isNull':
      return sql`${column} IS NULL`;
    case 'notNull':
      return sql`${column} IS NOT NULL`;
  }
}

/** The member's scope as a condition on `t`: no scope is `FALSE`, never an empty filter. */
export function scopeSql(scope: ScopeSpec): Prisma.Sql {
  if (scope.kind === 'all') return sql`TRUE`;
  if (scope.kind === 'none') return sql`FALSE`;
  const alternatives = scope.anyOf.map((predicates) => sql`(${Prisma.join(predicates.map(predicateSql), ' AND ')})`);
  return sql`(${Prisma.join(alternatives, ' OR ')})`;
}

/** Tenant, soft delete, filters and scope, all on ticket `t`; to be ANDed into the WHERE of the query. */
export function ticketPredicate(query: ReportQuery): Prisma.Sql {
  const parts: Prisma.Sql[] = [sql`t.tenant_id = ${query.tenantId}::uuid`, sql`t.deleted_at IS NULL`];
  if (query.companyId !== undefined) parts.push(sql`t.company_id = ${query.companyId}::uuid`);
  if (query.workflowId !== undefined) parts.push(sql`t.workflow_id = ${query.workflowId}::uuid`);
  if (query.departmentId !== undefined) parts.push(sql`t.department_id = ${query.departmentId}::uuid`);
  if (query.siteId !== undefined) parts.push(sql`t.site_id = ${query.siteId}::uuid`);
  parts.push(scopeSql(query.scope));
  return Prisma.join(parts, ' AND ');
}

/** The ticket and its company: the join every report starts from. */
export const TICKET_JOIN = sql`tickets t JOIN companies c ON c.tenant_id = t.tenant_id AND c.id = t.company_id`;

/**
 * `column` falls in the period, in the time zone of the ticket's company: first a coarse UTC range (which an index can
 * serve), then the exact local midnights.
 */
export function inPeriod(column: Prisma.Sql, { period }: ReportQuery): Prisma.Sql {
  return sql`(${column} >= ${period.coarseLow} AND ${column} < ${period.coarseHigh}
    AND ${column} >= (${period.from}::date)::timestamp AT TIME ZONE c.time_zone
    AND ${column} < ((${period.to}::date + 1))::timestamp AT TIME ZONE c.time_zone)`;
}

/** Only the coarse range: to pick the rows that may matter before the exact test. */
export function inCoarsePeriod(column: Prisma.Sql, { period }: ReportQuery): Prisma.Sql {
  return sql`(${column} >= ${period.coarseLow} AND ${column} < ${period.coarseHigh})`;
}

/** A clock of a parallel signer that was cancelled because another one rejected: it measures nobody. */
export const NOT_CANCELLED_SIGNATURE = sql`NOT EXISTS (
  SELECT 1 FROM ticket_parallel_tasks p
  WHERE p.tenant_id = k.tenant_id AND p.ticket_id = k.ticket_id AND p.step_id = k.step_id AND p.loop = k.loop
    AND p.user_id = k.responsible_id AND p.status = 'CANCELLED')`;

export const pct = (part: number, other: number): number | null => (part + other === 0 ? null : Math.round((1000 * part) / (part + other)) / 10);
export const whole = (value: number | null | undefined): number | null => (value === null || value === undefined ? null : Math.round(value));
