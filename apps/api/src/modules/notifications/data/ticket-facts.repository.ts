import { Injectable } from '@nestjs/common';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';

export interface TicketFacts {
  readonly number: string;
  readonly title: string;
  readonly creatorId: string;
  readonly registeredById: string | null;
  readonly workflowId: string;
}

export interface TenantFacts {
  readonly name: string;
  readonly active: boolean;
}

/** Reads, in the tenant's own transaction, what the notification handlers need to decide who to tell. */
@Injectable()
export class TicketFactsRepository {
  async tenant(tx: WorkerTransaction, tenantId: string): Promise<TenantFacts | undefined> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, status: true } });
    return tenant === null ? undefined : { name: tenant.name, active: tenant.status === 'ACTIVE' };
  }

  async ticket(tx: WorkerTransaction, tenantId: string, ticketId: string): Promise<TicketFacts | undefined> {
    const ticket = await tx.ticket.findFirst({ where: { tenantId, id: ticketId, deletedAt: null }, select: { number: true, title: true, creatorId: true, registeredById: true, workflowId: true } });
    return ticket === null ? undefined : { number: ticket.number.toString(), title: ticket.title, creatorId: ticket.creatorId, registeredById: ticket.registeredById, workflowId: ticket.workflowId };
  }

  async eventActor(tx: WorkerTransaction, tenantId: string, eventId: string): Promise<string | null> {
    return (await tx.ticketEvent.findFirst({ where: { tenantId, id: eventId }, select: { actorId: true } }))?.actorId ?? null;
  }

  async assignees(tx: WorkerTransaction, tenantId: string, ticketId: string): Promise<Array<{ userId: string; type: string }>> {
    return tx.ticketAssignee.findMany({ where: { tenantId, ticketId }, select: { userId: true, type: true }, orderBy: { userId: 'asc' } });
  }

  /** People who observe the workflow: by name, through an active group or by position. Resolved now, so changes apply at once. */
  async observerIds(tx: WorkerTransaction, tenantId: string, workflowId: string): Promise<string[]> {
    const observers = await tx.workflowObserver.findMany({ where: { tenantId, workflowId }, select: { userId: true, groupId: true, positionId: true } });
    const ids = new Set(observers.flatMap((observer) => (observer.userId === null ? [] : [observer.userId])));
    const groupIds = observers.flatMap((observer) => (observer.groupId === null ? [] : [observer.groupId]));
    const positionIds = observers.flatMap((observer) => (observer.positionId === null ? [] : [observer.positionId]));
    if (groupIds.length > 0) {
      const members = await tx.groupMember.findMany({ where: { tenantId, groupId: { in: groupIds }, group: { isActive: true } }, select: { userId: true } });
      for (const member of members) ids.add(member.userId);
    }
    if (positionIds.length > 0) {
      const members = await tx.membership.findMany({ where: { tenantId, positionId: { in: positionIds }, status: 'ACTIVE' }, select: { userId: true } });
      for (const member of members) ids.add(member.userId);
    }
    return [...ids].sort();
  }

  async incident(tx: WorkerTransaction, tenantId: string, incidentId: string): Promise<{ createdById: string; assignedToId: string } | undefined> {
    return (await tx.ticketIncident.findFirst({ where: { tenantId, id: incidentId }, select: { createdById: true, assignedToId: true } })) ?? undefined;
  }

  async clock(tx: WorkerTransaction, tenantId: string, clockId: string): Promise<{ completedAt: Date | null; responsibleId: string | null; ticketStatus: string } | undefined> {
    const clock = await tx.ticketSlaClock.findFirst({ where: { tenantId, id: clockId }, select: { completedAt: true, responsibleId: true, ticket: { select: { status: true } } } });
    return clock === null ? undefined : { completedAt: clock.completedAt, responsibleId: clock.responsibleId, ticketStatus: clock.ticket.status };
  }
}
