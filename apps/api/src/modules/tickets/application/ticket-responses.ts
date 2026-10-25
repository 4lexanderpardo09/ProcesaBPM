import {
  type NamedRefResponse,
  tableColumnTotals,
  type TicketDetailResponse,
  type TicketEventResponse,
  type TicketSummaryResponse,
  type TicketValueNamesResponse,
} from '@procesabpm/shared';
import type { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { fullName, type PersonName } from '../domain/person-name.js';
import { currentSla } from '../domain/ticket-sla.js';

export type TicketSummaryRow = Awaited<ReturnType<TicketQueryRepository['list']>>['rows'][number];
export type TicketDetailRow = NonNullable<Awaited<ReturnType<TicketQueryRepository['findDetail']>>>;
export type TicketEventRow = NonNullable<Awaited<ReturnType<TicketQueryRepository['findTimeline']>>>[number];

const personRef = (id: string, person: PersonName): NamedRefResponse => ({ id, name: fullName(person) });

/** A nullable person column and its relation: both are null together (composite foreign key). */
const optionalPersonRef = (id: string | null, person: PersonName | null): NamedRefResponse | null => (id === null || person === null ? null : personRef(id, person));

const slaOf = (row: TicketSummaryRow, now: Date): TicketSummaryResponse['sla'] => {
  const sla = currentSla(row.slaClocks, now);
  return sla === null ? null : { dueAt: sla.dueAt.toISOString(), overdue: sla.overdue, paused: sla.paused };
};

/** `now` decides whether the current step is overdue. */
export const toSummary = (row: TicketSummaryRow, now: Date): TicketSummaryResponse => ({
  id: row.id,
  number: row.number.toString(),
  title: row.title,
  status: row.status,
  companyId: row.companyId,
  creatorId: row.creatorId,
  subcategoryId: row.subcategoryId,
  currentStepId: row.currentStepId,
  priorityId: row.priorityId,
  createdAt: row.createdAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
  tags: row.tags.map((entry) => entry.tag),
  creator: personRef(row.creatorId, row.creator),
  subcategory: { id: row.subcategoryId, name: row.subcategory.name, category: row.subcategory.category },
  currentStep: row.currentStep,
  priority: row.priority,
  workflowPriority: row.subcategory.defaultPriority,
  assignees: row.assignees.map((assignee) => ({ userId: assignee.userId, name: fullName(assignee.membership), type: assignee.type, assignedAt: assignee.assignedAt.toISOString() })),
  sla: slaOf(row, now),
});

/** The column totals of the TABLE fields that ask for them, by field code. */
const totalsOf = (fieldValues: TicketDetailRow['fieldValues']): Record<string, Record<string, string>> =>
  Object.fromEntries(
    fieldValues
      .filter((entry) => entry.field.type === 'TABLE')
      .map((entry) => [entry.field.code, tableColumnTotals(entry.field.config as Record<string, unknown>, entry.value)] as const)
      .filter(([, totals]) => Object.keys(totals).length > 0),
  );

const openIncidentOf = (row: TicketDetailRow): TicketDetailResponse['openIncident'] => {
  const incident = row.incidents[0];
  if (incident === undefined) return null;
  return {
    id: incident.id,
    assignedToId: incident.assignedToId,
    createdById: incident.createdById,
    assignedTo: personRef(incident.assignedToId, incident.assignedTo),
    createdBy: personRef(incident.createdById, incident.createdBy),
    openedAt: incident.openedAt.toISOString(),
    descriptionHtml: incident.description,
  };
};

/** The detail of a ticket as it is, for anyone who reads it; what the caller may do with it comes apart (`actions`). */
export type TicketDetailBody = Omit<TicketDetailResponse, 'actions'>;

/** `valueNames` names the people, sites and preset entries the values point to (resolved by the caller, in the same transaction). */
export const toDetail = (row: TicketDetailRow, now: Date, valueNames: TicketValueNamesResponse): TicketDetailBody => {
  const visit = row.stepVisits[0];
  return {
    ...toSummary(row, now),
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    registeredById: row.registeredById,
    descriptionHtml: row.descriptionHtml,
    departmentId: row.departmentId,
    siteId: row.siteId,
    currentLoop: row.currentLoop,
    closedById: row.closedById,
    openVisit: visit === undefined ? null : { id: visit.id, stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt.toISOString(), dueAt: visit.dueAt?.toISOString() ?? null },
    awaitingDispatch: row.status === 'OPEN' && row.assignees.length === 0,
    parallelTasks: row.parallelTasks
      .filter((task) => task.stepId === row.currentStepId && task.loop === row.currentLoop)
      .map((task) => ({ id: task.id, userId: task.userId, name: fullName(task.membership), status: task.status, completedAt: task.completedAt?.toISOString() ?? null })),
    openIncident: openIncidentOf(row),
    waitingUntil: visit?.resumeAt?.toISOString() ?? null,
    values: Object.fromEntries(row.fieldValues.map((entry) => [entry.field.code, entry.value])),
    totals: totalsOf(row.fieldValues),
    company: row.company,
    registeredBy: optionalPersonRef(row.registeredById, row.registeredBy),
    closedBy: optionalPersonRef(row.closedById, row.closedBy),
    department: row.department,
    site: row.site,
    valueNames,
  };
};

export const toEvent = (event: TicketEventRow): TicketEventResponse => ({
  id: event.id,
  type: event.type,
  stepId: event.stepId,
  transitionId: event.transitionId,
  loop: event.loop,
  actorId: event.actorId,
  assigneeId: event.assigneeId,
  commentHtml: event.commentHtml,
  data: event.data,
  createdAt: event.createdAt.toISOString(),
  actor: optionalPersonRef(event.actorId, event.actor),
  assignee: optionalPersonRef(event.assigneeId, event.assignee),
  step: event.step,
  transition: event.transition === null ? null : { id: event.transition.id, name: event.transition.label },
});
