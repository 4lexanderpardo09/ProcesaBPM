import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { inCoarsePeriod, inPeriod, NOT_CANCELLED_SIGNATURE, type ReportQuery, TICKET_JOIN, ticketPredicate } from './report-sql.js';

const { sql } = Prisma;

export interface UserClockDbRow {
  readonly ticketNumber: string;
  readonly workflowName: string;
  readonly stepName: string;
  readonly loop: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly dueAt: Date | null;
  readonly businessMin: number | null;
  readonly pausedMin: number;
  readonly result: 'ON_TIME' | 'LATE' | null;
  readonly completionReason: string | null;
}

/** The person's clocks that ended in the period or are still running, inside the caller's scope. */
const clocksWhere = (query: ReportQuery, userId: string): Prisma.Sql => sql`
  ${ticketPredicate(query)} AND k.tenant_id = ${query.tenantId}::uuid AND k.responsible_id = ${userId}::uuid
  AND (k.completed_at IS NULL OR (${inCoarsePeriod(sql`k.completed_at`, query)} AND ${inPeriod(sql`k.completed_at`, query)}))
  AND ${NOT_CANCELLED_SIGNATURE}`;

const CLOCKS_FROM = sql`ticket_sla_clocks k JOIN ${TICKET_JOIN} ON t.tenant_id = k.tenant_id AND t.id = k.ticket_id`;

@Injectable()
export class UserDetailRepository {
  /** Newest first. */
  async clocks(tx: TenantTransaction, query: ReportQuery, userId: string, page: number, pageSize: number): Promise<UserClockDbRow[]> {
    return tx.$queryRaw<UserClockDbRow[]>`
      SELECT t.number::text AS "ticketNumber", w.name AS "workflowName", s.name AS "stepName", k.loop AS loop,
        k.started_at AS "startedAt", k.completed_at AS "completedAt", k.due_at AS "dueAt",
        k.business_minutes AS "businessMin", k.paused_minutes AS "pausedMin", k.result::text AS result, k.completion_reason::text AS "completionReason"
      FROM ${CLOCKS_FROM}
      JOIN steps s ON s.tenant_id = k.tenant_id AND s.id = k.step_id
      JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
      WHERE ${clocksWhere(query, userId)}
      ORDER BY k.started_at DESC, k.id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  }

  async countClocks(tx: TenantTransaction, query: ReportQuery, userId: string): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ total: number }>>`SELECT count(*)::int AS total FROM ${CLOCKS_FROM} WHERE ${clocksWhere(query, userId)}`;
    return row!.total;
  }

  async name(tx: TenantTransaction, tenantId: string, userId: string): Promise<string | null> {
    const membership = await tx.membership.findFirst({ where: { tenantId, userId }, select: { user: { select: { firstName: true, lastName: true } } } });
    return membership === null ? null : `${membership.user.firstName} ${membership.user.lastName}`.trim();
  }
}
