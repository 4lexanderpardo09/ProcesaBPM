import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

/** The most incidents a report groups: one more is read to know the filter was too wide (the counts would be wrong). */
export const INCIDENT_ROW_CAP = 50_000;

export interface IncidentRow {
  readonly workflowName: string;
  readonly stepName: string;
  readonly openerId: string;
  readonly openerName: string;
  readonly assigneeId: string;
  readonly assigneeName: string;
  readonly resolved: boolean;
  /** Business minutes the incident paused the SLA for; only known once it was resolved. */
  readonly pausedMin: number | null;
}

@Injectable()
export class IncidentRepository {
  async rows(tx: TenantTransaction, query: ReportQuery): Promise<IncidentRow[]> {
    return tx.$queryRaw<IncidentRow[]>`
      SELECT w.name AS "workflowName", s.name AS "stepName",
        i.created_by_id::text AS "openerId", (uo.first_name || ' ' || uo.last_name) AS "openerName",
        i.assigned_to_id::text AS "assigneeId", (ua.first_name || ' ' || ua.last_name) AS "assigneeName",
        (i.status = 'RESOLVED') AS resolved,
        CASE WHEN jsonb_typeof(e.data -> 'pausedBusinessMinutes') = 'number' THEN (e.data ->> 'pausedBusinessMinutes')::float8 END AS "pausedMin"
      FROM ticket_incidents i
      JOIN ${TICKET_JOIN} ON t.tenant_id = i.tenant_id AND t.id = i.ticket_id
      JOIN steps s ON s.tenant_id = i.tenant_id AND s.id = i.step_id
      JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
      JOIN users uo ON uo.id = i.created_by_id
      JOIN users ua ON ua.id = i.assigned_to_id
      LEFT JOIN ticket_events e ON e.tenant_id = i.tenant_id AND e.ticket_id = i.ticket_id AND e.type = 'INCIDENT_RESOLVED' AND e.data ->> 'incidentId' = i.id::text
      WHERE ${ticketPredicate(query)} AND i.tenant_id = ${query.tenantId}::uuid AND ${inCoarsePeriod(sql`i.opened_at`, query)} AND ${inPeriod(sql`i.opened_at`, query)}
      ORDER BY i.opened_at, i.id
      LIMIT ${INCIDENT_ROW_CAP + 1}`;
  }
}
