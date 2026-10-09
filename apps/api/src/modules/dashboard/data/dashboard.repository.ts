import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PendingTicketRow {
  readonly id: string;
  readonly number: bigint;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly currentStepId: string | null;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
}

const TICKET_SELECT = { id: true, number: true, title: true, status: true, currentStepId: true, createdAt: true } as const;

/** Every query carries the access filter (the tickets the caller may read) on top of the tenant. */
@Injectable()
export class DashboardRepository {
  count(tx: TenantTransaction, tenantId: string, filters: readonly Record<string, unknown>[]): Promise<number> {
    return tx.ticket.count({ where: { AND: [{ tenantId, deletedAt: null }, ...filters] } as never });
  }

  /**
   * The tickets waiting on the member, most urgent first. The order is decided in the database, before the limit: the
   * tickets with a running SLA clock of theirs come by due date, and only the room left goes to the rest (newest first).
   * Sorting after a `take` by number would drop the most overdue tickets of anyone with more than `take` pending.
   */
  async pending(tx: TenantTransaction, tenantId: string, userId: string, access: Record<string, unknown>, take: number): Promise<PendingTicketRow[]> {
    const waiting = { AND: [{ tenantId, deletedAt: null, status: { in: ['OPEN', 'PAUSED'] }, assignees: { some: { tenantId, userId } } }, access] };
    const clocks = await tx.ticketSlaClock.findMany({
      where: { tenantId, responsibleId: userId, completedAt: null, pausedAt: null, dueAt: { not: null }, ticket: waiting } as never,
      select: { dueAt: true, ticket: { select: TICKET_SELECT } },
      orderBy: [{ dueAt: 'asc' }, { ticketId: 'asc' }],
      take,
    });
    // One clock per ticket and person is the rule; the earliest due wins if there were ever two.
    const due = new Map<string, PendingTicketRow>();
    for (const clock of clocks) if (!due.has(clock.ticket.id)) due.set(clock.ticket.id, { ...clock.ticket, dueAt: clock.dueAt });
    if (due.size >= take) return [...due.values()];
    const rest = await tx.ticket.findMany({
      where: { AND: [waiting, { id: { notIn: [...due.keys()] } }] } as never,
      select: TICKET_SELECT,
      orderBy: { number: 'desc' },
      take: take - due.size,
    });
    return [...due.values(), ...rest.map((row) => ({ ...row, dueAt: null }))];
  }
}
