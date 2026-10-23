import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, NOT_CANCELLED_SIGNATURE, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

export interface SiteStatsRow {
  readonly siteId: string | null;
  readonly siteName: string | null;
  readonly tickets: number;
  readonly responsibles: number;
  readonly delivered: number;
  readonly onTime: number;
  readonly late: number;
  readonly processErrors: number;
  readonly otherErrors: number;
  readonly avg: number | null;
}

export interface HeatmapStatsRow {
  readonly siteId: string | null;
  readonly siteName: string | null;
  readonly userId: string;
  readonly name: string | null;
  readonly delivered: number;
  readonly processErrors: number;
  readonly otherErrors: number;
  readonly avg: number | null;
  /** The average of every clock of the site, the peers' reference. */
  readonly siteAvg: number | null;
}

/**
 * Every site with the ancestor it is counted under: the one at `level`, or itself when it is already above it. The
 * tree is walked up from each site while it is below the level.
 */
const rolledSites = (tenantId: string, level: number): Prisma.Sql => sql`
  up AS (
    SELECT s.id AS site_id, s.id AS anc_id, s.level, s.parent_id FROM sites s WHERE s.tenant_id = ${tenantId}::uuid
    UNION ALL
    SELECT up.site_id, p.id, p.level, p.parent_id FROM up JOIN sites p ON p.tenant_id = ${tenantId}::uuid AND p.id = up.parent_id
    WHERE up.level > ${level}
  ),
  rolled AS (
    SELECT DISTINCT ON (up.site_id) up.site_id, up.anc_id FROM up ORDER BY up.site_id, up.level
  )`;

/** Clocks that ended in the period, with the site they count under. */
const periodClocks = (query: ReportQuery): Prisma.Sql => sql`
  clk AS (
    SELECT r.anc_id AS site, k.responsible_id, k.ticket_id, k.result, k.completion_reason, k.business_minutes
    FROM ticket_sla_clocks k JOIN ${TICKET_JOIN} ON t.tenant_id = k.tenant_id AND t.id = k.ticket_id
    LEFT JOIN rolled r ON r.site_id = t.site_id
    WHERE ${ticketPredicate(query)} AND k.tenant_id = ${query.tenantId}::uuid AND k.completed_at IS NOT NULL AND k.responsible_id IS NOT NULL
      AND ${inCoarsePeriod(sql`k.completed_at`, query)} AND ${inPeriod(sql`k.completed_at`, query)} AND ${NOT_CANCELLED_SIGNATURE}
  )`;

/** Errors registered in the period, with the site of their ticket. */
const periodErrors = (query: ReportQuery): Prisma.Sql => sql`
  err AS (
    SELECT r.anc_id AS site, e.responsible_id, e.is_process_error
    FROM ticket_errors e JOIN ${TICKET_JOIN} ON t.tenant_id = e.tenant_id AND t.id = e.ticket_id
    LEFT JOIN rolled r ON r.site_id = t.site_id
    WHERE ${ticketPredicate(query)} AND e.tenant_id = ${query.tenantId}::uuid AND ${inCoarsePeriod(sql`e.created_at`, query)} AND ${inPeriod(sql`e.created_at`, query)}
  )`;

@Injectable()
export class SiteReportRepository {
  /** One row per site at the level (and one for the tickets without a site), with anything to show. */
  async sites(tx: TenantTransaction, query: ReportQuery, level: number): Promise<SiteStatsRow[]> {
    return tx.$queryRaw<SiteStatsRow[]>`
      WITH RECURSIVE ${rolledSites(query.tenantId, level)}, ${periodClocks(query)}, ${periodErrors(query)},
      created AS (
        SELECT r.anc_id AS site, count(*)::int AS tickets
        FROM ${TICKET_JOIN} LEFT JOIN rolled r ON r.site_id = t.site_id
        WHERE ${ticketPredicate(query)} AND ${inCoarsePeriod(sql`t.created_at`, query)} AND ${inPeriod(sql`t.created_at`, query)}
        GROUP BY r.anc_id
      ),
      clocks AS (
        SELECT site, count(DISTINCT responsible_id)::int AS responsibles,
          (count(DISTINCT ticket_id) FILTER (WHERE completion_reason <> 'REASSIGNED'))::int AS delivered,
          (count(*) FILTER (WHERE result = 'ON_TIME' AND completion_reason <> 'REASSIGNED'))::int AS on_time,
          (count(*) FILTER (WHERE result = 'LATE'))::int AS late,
          (avg(business_minutes))::float8 AS avg
        FROM clk GROUP BY site
      ),
      errors AS (
        SELECT site, (count(*) FILTER (WHERE is_process_error))::int AS process, (count(*) FILTER (WHERE NOT is_process_error))::int AS other
        FROM err GROUP BY site
      ),
      keys AS (SELECT site FROM created UNION SELECT site FROM clocks UNION SELECT site FROM errors)
      SELECT k.site::text AS "siteId", s.name AS "siteName",
        coalesce(cr.tickets, 0)::int AS tickets, coalesce(cl.responsibles, 0)::int AS responsibles, coalesce(cl.delivered, 0)::int AS delivered,
        coalesce(cl.on_time, 0)::int AS "onTime", coalesce(cl.late, 0)::int AS late,
        coalesce(er.process, 0)::int AS "processErrors", coalesce(er.other, 0)::int AS "otherErrors", cl.avg
      FROM keys k
      LEFT JOIN sites s ON s.tenant_id = ${query.tenantId}::uuid AND s.id = k.site
      LEFT JOIN created cr ON cr.site IS NOT DISTINCT FROM k.site
      LEFT JOIN clocks cl ON cl.site IS NOT DISTINCT FROM k.site
      LEFT JOIN errors er ON er.site IS NOT DISTINCT FROM k.site
      ORDER BY s.name NULLS LAST, k.site`;
  }

  /** One row per site and person who had clocks or errors in the period. */
  async heatmap(tx: TenantTransaction, query: ReportQuery, level: number): Promise<HeatmapStatsRow[]> {
    return tx.$queryRaw<HeatmapStatsRow[]>`
      WITH RECURSIVE ${rolledSites(query.tenantId, level)}, ${periodClocks(query)}, ${periodErrors(query)},
      people AS (
        SELECT site, responsible_id, (count(DISTINCT ticket_id) FILTER (WHERE completion_reason <> 'REASSIGNED'))::int AS delivered, (avg(business_minutes))::float8 AS avg
        FROM clk GROUP BY site, responsible_id
      ),
      site_avg AS (SELECT site, (avg(business_minutes))::float8 AS avg FROM clk GROUP BY site),
      errors AS (
        SELECT site, responsible_id, (count(*) FILTER (WHERE is_process_error))::int AS process, (count(*) FILTER (WHERE NOT is_process_error))::int AS other
        FROM err GROUP BY site, responsible_id
      ),
      keys AS (SELECT site, responsible_id FROM people UNION SELECT site, responsible_id FROM errors)
      SELECT k.site::text AS "siteId", s.name AS "siteName", k.responsible_id::text AS "userId", u.first_name || ' ' || u.last_name AS name,
        coalesce(p.delivered, 0)::int AS delivered, coalesce(e.process, 0)::int AS "processErrors", coalesce(e.other, 0)::int AS "otherErrors",
        p.avg, sa.avg AS "siteAvg"
      FROM keys k
      LEFT JOIN sites s ON s.tenant_id = ${query.tenantId}::uuid AND s.id = k.site
      LEFT JOIN people p ON p.site IS NOT DISTINCT FROM k.site AND p.responsible_id = k.responsible_id
      LEFT JOIN errors e ON e.site IS NOT DISTINCT FROM k.site AND e.responsible_id = k.responsible_id
      LEFT JOIN site_avg sa ON sa.site IS NOT DISTINCT FROM k.site
      LEFT JOIN memberships m ON m.tenant_id = ${query.tenantId}::uuid AND m.user_id = k.responsible_id
      LEFT JOIN users u ON u.id = m.user_id
      ORDER BY s.name NULLS LAST, k.site, (coalesce(e.process, 0) + coalesce(e.other, 0)) DESC, name, k.responsible_id`;
  }
}
