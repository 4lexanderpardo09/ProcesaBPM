import type { Condition, SubjectDefinition, SubjectContext } from '../../authorization/domain/subject-registry.js';

export const TICKET_SUBJECT = 'Ticket';
/** Actions that let someone read a ticket; each one scopes which tickets (read_all has no scope). */
export const TICKET_READ_ACTIONS = ['read_created', 'read_assigned', 'read_observed', 'read_all'] as const;

/** Tickets the member created, or that someone registered for them. */
export const createdBy = (userId: string): Condition => ({ OR: [{ creatorId: userId }, { registeredById: userId }] });

/** Tickets of workflows the member observes: by name, through an active group or by position. Resolved live, so changes apply at once. */
export function observedBy({ userId, membership }: SubjectContext): Condition {
  const observers: Condition[] = [{ userId }, { group: { isActive: true, members: { some: { userId } } } }];
  if (membership.positionId !== null && membership.positionId !== undefined) observers.push({ positionId: membership.positionId });
  return { workflow: { observers: { some: { OR: observers } } } };
}

/** Tickets the member is assigned to now, or was before (their clocks stay as the record of it). */
export const assignedTo = (userId: string): Condition => ({ OR: [{ assignees: { some: { userId } } }, { slaClocks: { some: { responsibleId: userId } } }] });

/** The ticket as an authorization subject: built-in scopes for the three scoped reads; stored conditions may use these fields. */
export const ticketSubject: SubjectDefinition = {
  fields: new Set(['companyId', 'departmentId', 'siteId', 'subcategoryId', 'workflowId', 'priorityId', 'status', 'creatorId']),
  impliedConditions: {
    read_created: ({ userId }) => createdBy(userId),
    read_assigned: ({ userId }) => assignedTo(userId),
    read_observed: observedBy,
  },
};
