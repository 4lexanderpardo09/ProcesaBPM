import { Injectable } from '@nestjs/common';
import { parseBlockConfig } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TicketFacts {
  readonly number: string;
  readonly title: string;
  readonly creatorId: string;
  readonly registeredById: string | null;
  readonly workflowId: string;
  readonly closedAt: Date | null;
}

export type BlockRecipient = { readonly kind: 'CREATOR' | 'ASSIGNEES' | 'OBSERVERS' } | { readonly kind: 'USER' | 'POSITION' | 'GROUP'; readonly id: string };

export interface NotificationBlock {
  readonly recipients: readonly BlockRecipient[];
  readonly channels: ReadonlyArray<'EMAIL' | 'IN_APP'>;
  readonly subject: string;
  readonly body: string;
}

export interface TenantFacts {
  readonly name: string;
  readonly active: boolean;
}

const groupedBy = (pairs: ReadonlyArray<readonly [string, string]>): Map<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const [key, userId] of pairs) grouped.set(key, [...(grouped.get(key) ?? []), userId]);
  return grouped;
};

/** Reads, in the tenant's own transaction, what the notification handlers need to decide who to tell. */
@Injectable()
export class TicketFactsRepository {
  async tenant(tx: TenantTransaction, tenantId: string): Promise<TenantFacts | undefined> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, status: true } });
    return tenant === null ? undefined : { name: tenant.name, active: tenant.status === 'ACTIVE' };
  }

  async ticket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketFacts | undefined> {
    const ticket = await tx.ticket.findFirst({ where: { tenantId, id: ticketId, deletedAt: null }, select: { number: true, title: true, creatorId: true, registeredById: true, workflowId: true, closedAt: true } });
    return ticket === null ? undefined : { number: ticket.number.toString(), title: ticket.title, creatorId: ticket.creatorId, registeredById: ticket.registeredById, workflowId: ticket.workflowId, closedAt: ticket.closedAt };
  }

  async event(tx: TenantTransaction, tenantId: string, eventId: string): Promise<{ actorId: string | null; createdAt: Date } | undefined> {
    return (await tx.ticketEvent.findFirst({ where: { tenantId, id: eventId }, select: { actorId: true, createdAt: true } })) ?? undefined;
  }

  async assignees(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<Array<{ userId: string; type: string }>> {
    return tx.ticketAssignee.findMany({ where: { tenantId, ticketId }, select: { userId: true, type: true }, orderBy: { userId: 'asc' } });
  }

  /** People who observe the workflow: by name, through an active group or by position. Resolved now, so changes apply at once. */
  async observerIds(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<string[]> {
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

  /** Active members of each of the given positions. */
  async positionMembers(tx: TenantTransaction, tenantId: string, positionIds: readonly string[]): Promise<Map<string, string[]>> {
    if (positionIds.length === 0) return new Map();
    const members = await tx.membership.findMany({ where: { tenantId, positionId: { in: [...positionIds] }, status: 'ACTIVE' }, select: { userId: true, positionId: true } });
    return groupedBy(members.flatMap((member) => (member.positionId === null ? [] : [[member.positionId, member.userId] as const])));
  }

  /** Members of each of the given groups, as long as the group is active. */
  async groupMembers(tx: TenantTransaction, tenantId: string, groupIds: readonly string[]): Promise<Map<string, string[]>> {
    if (groupIds.length === 0) return new Map();
    const members = await tx.groupMember.findMany({ where: { tenantId, groupId: { in: [...groupIds] }, group: { isActive: true } }, select: { userId: true, groupId: true } });
    return groupedBy(members.map((member) => [member.groupId, member.userId] as const));
  }

  /** The configuration of a NOTIFICATION block of the version the ticket runs, or `undefined` when it is not there or is invalid. */
  async notificationBlock(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string): Promise<NotificationBlock | undefined> {
    const ticket = await tx.ticket.findFirst({ where: { tenantId, id: ticketId }, select: { workflowVersionId: true } });
    if (ticket === null) return undefined;
    const step = await tx.step.findFirst({ where: { tenantId, id: stepId, versionId: ticket.workflowVersionId, type: 'NOTIFICATION' }, select: { config: true } });
    if (step === null) return undefined;
    const parsed = parseBlockConfig('NOTIFICATION', step.config);
    return parsed.valid ? (parsed.config as unknown as NotificationBlock) : undefined;
  }

  async incident(tx: TenantTransaction, tenantId: string, incidentId: string): Promise<{ createdById: string; assignedToId: string } | undefined> {
    return (await tx.ticketIncident.findFirst({ where: { tenantId, id: incidentId }, select: { createdById: true, assignedToId: true } })) ?? undefined;
  }

  async clock(tx: TenantTransaction, tenantId: string, clockId: string): Promise<{ completedAt: Date | null; responsibleId: string | null; ticketStatus: string } | undefined> {
    const clock = await tx.ticketSlaClock.findFirst({ where: { tenantId, id: clockId }, select: { completedAt: true, responsibleId: true, ticket: { select: { status: true } } } });
    return clock === null ? undefined : { completedAt: clock.completedAt, responsibleId: clock.responsibleId, ticketStatus: clock.ticket.status };
  }
}
