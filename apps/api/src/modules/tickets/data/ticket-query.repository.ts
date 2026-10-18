import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export type Where = Record<string, unknown>;

const PERSON_NAME = { user: { select: { firstName: true, lastName: true } } } as const;

/**
 * The listing row: ids plus the names a list shows and the open SLA clocks of the current step. Prisma loads the
 * relations for the whole page at once (never a query per ticket), inside the caller's transaction and so under RLS.
 */
const SUMMARY = {
  id: true,
  number: true,
  title: true,
  status: true,
  companyId: true,
  creatorId: true,
  subcategoryId: true,
  currentStepId: true,
  priorityId: true,
  createdAt: true,
  closedAt: true,
  creator: { select: PERSON_NAME },
  subcategory: { select: { name: true, category: { select: { id: true, name: true } } } },
  currentStep: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, color: true } },
  assignees: { select: { userId: true, type: true, assignedAt: true, membership: { select: PERSON_NAME } }, orderBy: { userId: 'asc' } },
  slaClocks: { where: { completedAt: null }, select: { dueAt: true, pausedAt: true } },
} as const;

const DETAIL = {
  ...SUMMARY,
  workflowId: true,
  workflowVersionId: true,
  registeredById: true,
  descriptionHtml: true,
  departmentId: true,
  siteId: true,
  currentLoop: true,
  closedById: true,
  stepVisits: { where: { exitedAt: null }, select: { id: true, stepId: true, loop: true, enteredAt: true, dueAt: true, resumeAt: true }, take: 1 },
  parallelTasks: { select: { id: true, userId: true, status: true, completedAt: true, stepId: true, loop: true }, orderBy: { id: 'asc' } },
  incidents: { where: { status: 'OPEN' }, select: { id: true, assignedToId: true, createdById: true, openedAt: true, description: true }, take: 1 },
  fieldValues: { select: { value: true, field: { select: { code: true, type: true, config: true } } } },
} as const;

/** What a real-time subscriber may see of a ticket: its state and the ids of its assignees, never its content. */
const REALTIME_SUMMARY = {
  id: true,
  status: true,
  currentStepId: true,
  currentLoop: true,
  assignees: { select: { userId: true, type: true }, orderBy: { userId: 'asc' } },
  events: { select: { seq: true }, orderBy: { seq: 'desc' }, take: 1 },
} as const;

/** The caller's own tags on a ticket (never anyone else's): part of the summary and the detail. */
const withTags = (userId: string) => ({ tags: { where: { userId }, select: { tag: { select: { id: true, name: true, color: true } } } } }) as const;

/** The tenant's tickets that are not deleted and meet every filter. */
const liveTickets = (tenantId: string, filters: readonly Where[]) => ({ AND: [{ tenantId, deletedAt: null }, ...filters] }) as never;

/** Reads of tickets. The caller passes the access filter (per-record authorization): it is part of every query. */
@Injectable()
export class TicketQueryRepository {
  findDetail(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where, userId: string) {
    return tx.ticket.findFirst({ where: { AND: [{ tenantId, id: ticketId, deletedAt: null }, access] } as never, select: { ...DETAIL, ...withTags(userId) } });
  }

  async list(tx: TenantTransaction, tenantId: string, filters: readonly Where[], window: { skip: number; take: number }, userId: string) {
    // One query after another: an interactive transaction has a single connection.
    const rows = await tx.ticket.findMany({ where: liveTickets(tenantId, filters), select: { ...SUMMARY, ...withTags(userId) }, orderBy: { number: 'desc' }, ...window });
    return { rows, total: await this.count(tx, tenantId, filters) };
  }

  /** How many live tickets of the tenant meet every filter. */
  count(tx: TenantTransaction, tenantId: string, filters: readonly Where[]): Promise<number> {
    return tx.ticket.count({ where: liveTickets(tenantId, filters) });
  }

  findRealtimeSummary(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where) {
    return tx.ticket.findFirst({ where: { AND: [{ tenantId, id: ticketId, deletedAt: null }, access] } as never, select: REALTIME_SUMMARY });
  }

  /** The ids, among the given ones, that the access filter lets the caller see. */
  async readableIds(tx: TenantTransaction, tenantId: string, ticketIds: readonly string[], access: Where): Promise<string[]> {
    const rows = await tx.ticket.findMany({ where: { AND: [{ tenantId, id: { in: [...ticketIds] }, deletedAt: null }, access] } as never, select: { id: true } });
    return rows.map((row) => row.id);
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
      orderBy: { seq: 'asc' },
    });
  }
}
