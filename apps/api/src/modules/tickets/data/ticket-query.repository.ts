import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export type Where = Record<string, unknown>;

const SUMMARY = {
  id: true,
  number: true,
  title: true,
  status: true,
  companyId: true,
  creatorId: true,
  subcategoryId: true,
  currentStepId: true,
  createdAt: true,
  closedAt: true,
} as const;

const DETAIL = {
  ...SUMMARY,
  workflowId: true,
  workflowVersionId: true,
  registeredById: true,
  descriptionHtml: true,
  priorityId: true,
  departmentId: true,
  siteId: true,
  currentLoop: true,
  closedById: true,
  assignees: { select: { userId: true, type: true, assignedAt: true }, orderBy: { userId: 'asc' } },
  stepVisits: { where: { exitedAt: null }, select: { id: true, stepId: true, loop: true, enteredAt: true, dueAt: true }, take: 1 },
  incidents: { where: { status: 'OPEN' }, select: { id: true, assignedToId: true, createdById: true, openedAt: true, description: true }, take: 1 },
  fieldValues: { select: { value: true, field: { select: { code: true } } } },
} as const;

/** Reads of tickets. The caller passes the access filter (per-record authorization): it is part of every query. */
@Injectable()
export class TicketQueryRepository {
  findDetail(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where) {
    return tx.ticket.findFirst({ where: { AND: [{ tenantId, id: ticketId, deletedAt: null }, access] } as never, select: DETAIL });
  }

  async list(tx: TenantTransaction, tenantId: string, filters: readonly Where[], window: { skip: number; take: number }) {
    const where = { AND: [{ tenantId, deletedAt: null }, ...filters] } as never;
    // One query after another: an interactive transaction has a single connection.
    const rows = await tx.ticket.findMany({ where, select: SUMMARY, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...window });
    return { rows, total: await tx.ticket.count({ where }) };
  }

  /** Whether the access filter lets the caller see the ticket. */
  async isAccessible(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where): Promise<boolean> {
    return (await tx.ticket.count({ where: { AND: [{ tenantId, id: ticketId, deletedAt: null }, access] } as never })) > 0;
  }

  async findTimeline(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where) {
    if (!(await this.isAccessible(tx, tenantId, ticketId, access))) return undefined;
    return tx.ticketEvent.findMany({
      where: { tenantId, ticketId },
      select: { id: true, type: true, stepId: true, transitionId: true, loop: true, actorId: true, assigneeId: true, commentHtml: true, data: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
