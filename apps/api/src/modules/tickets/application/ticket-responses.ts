import { tableColumnTotals, type TicketDetailResponse, type TicketSummaryResponse } from '@procesabpm/shared';
import type { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { currentSla } from '../domain/ticket-sla.js';

export type TicketSummaryRow = Awaited<ReturnType<TicketQueryRepository['list']>>['rows'][number];
export type TicketDetailRow = NonNullable<Awaited<ReturnType<TicketQueryRepository['findDetail']>>>;

interface PersonName {
  readonly user: { readonly firstName: string; readonly lastName: string };
}

const fullName = (person: PersonName): string => `${person.user.firstName} ${person.user.lastName}`.trim();

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
  creator: { id: row.creatorId, name: fullName(row.creator) },
  subcategory: { id: row.subcategoryId, name: row.subcategory.name, category: row.subcategory.category },
  currentStep: row.currentStep,
  priority: row.priority,
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

export const toDetail = (row: TicketDetailRow, now: Date): TicketDetailResponse => {
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
    parallelTasks: row.parallelTasks.filter((task) => task.stepId === row.currentStepId && task.loop === row.currentLoop).map((task) => ({ id: task.id, userId: task.userId, status: task.status, completedAt: task.completedAt?.toISOString() ?? null })),
    openIncident: row.incidents[0] === undefined ? null : { id: row.incidents[0].id, assignedToId: row.incidents[0].assignedToId, createdById: row.incidents[0].createdById, openedAt: row.incidents[0].openedAt.toISOString(), descriptionHtml: row.incidents[0].description },
    waitingUntil: visit?.resumeAt?.toISOString() ?? null,
    values: Object.fromEntries(row.fieldValues.map((entry) => [entry.field.code, entry.value])),
    totals: totalsOf(row.fieldValues),
  };
};
