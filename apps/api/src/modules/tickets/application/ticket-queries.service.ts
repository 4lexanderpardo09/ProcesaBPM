import { Inject, Injectable } from '@nestjs/common';
import { type ListTicketsQuery, NotFoundError, type Page, tableColumnTotals, type TicketDetailResponse, type TicketEventResponse, type TicketSummaryResponse } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { pageWindow } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { TicketQueryRepository, type Where } from '../data/ticket-query.repository.js';
import { createdBy, observedBy } from '../domain/ticket-subject.js';
import type { TicketActor } from '../../engine/application/locked-ticket.js';
import { readableTickets, ticketActorOf } from './ticket-access.js';

type SummaryRow = Awaited<ReturnType<TicketQueryRepository['list']>>['rows'][number];
type DetailRow = NonNullable<Awaited<ReturnType<TicketQueryRepository['findDetail']>>>;

const toSummary = (row: SummaryRow): TicketSummaryResponse => ({
  id: row.id,
  number: row.number.toString(),
  title: row.title,
  status: row.status,
  companyId: row.companyId,
  creatorId: row.creatorId,
  subcategoryId: row.subcategoryId,
  currentStepId: row.currentStepId,
  createdAt: row.createdAt.toISOString(),
  closedAt: row.closedAt?.toISOString() ?? null,
});

/** The column totals of the TABLE fields that ask for them, by field code. */
const totalsOf = (fieldValues: DetailRow['fieldValues']): Record<string, Record<string, string>> =>
  Object.fromEntries(
    fieldValues
      .filter((entry) => entry.field.type === 'TABLE')
      .map((entry) => [entry.field.code, tableColumnTotals(entry.field.config as Record<string, unknown>, entry.value)] as const)
      .filter(([, totals]) => Object.keys(totals).length > 0),
  );

const toDetail = (row: DetailRow): TicketDetailResponse => {
  const visit = row.stepVisits[0];
  return {
    ...toSummary(row),
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    registeredById: row.registeredById,
    descriptionHtml: row.descriptionHtml,
    priorityId: row.priorityId,
    departmentId: row.departmentId,
    siteId: row.siteId,
    currentLoop: row.currentLoop,
    closedById: row.closedById,
    openVisit: visit === undefined ? null : { id: visit.id, stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt.toISOString(), dueAt: visit.dueAt?.toISOString() ?? null },
    awaitingDispatch: row.status === 'OPEN' && row.assignees.length === 0,
    parallelTasks: row.parallelTasks.filter((task) => task.stepId === row.currentStepId && task.loop === row.currentLoop).map((task) => ({ id: task.id, userId: task.userId, status: task.status, completedAt: task.completedAt?.toISOString() ?? null })),
    openIncident: row.incidents[0] === undefined ? null : { id: row.incidents[0].id, assignedToId: row.incidents[0].assignedToId, createdById: row.incidents[0].createdById, openedAt: row.incidents[0].openedAt.toISOString(), descriptionHtml: row.incidents[0].description },
    assignees: row.assignees.map((assignee) => ({ userId: assignee.userId, type: assignee.type, assignedAt: assignee.assignedAt.toISOString() })),
    waitingUntil: visit?.resumeAt?.toISOString() ?? null,
    values: Object.fromEntries(row.fieldValues.map((entry) => [entry.field.code, entry.value])),
    totals: totalsOf(row.fieldValues),
  };
};

/** The read side of tickets. A ticket the caller may not read answers exactly like one that does not exist. */
@Injectable()
export class TicketQueriesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
  ) {}

  get(ability: AppAbility, ticketId: string): Promise<TicketDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const row = await this.tickets.findDetail(tx, this.context.require().tenantId, ticketId, readableTickets(ability));
      if (row === null) throw new NotFoundError();
      return toDetail(row);
    });
  }

  /** The caller as the engine needs them to act on tickets. */
  actorFor(principal: Principal, ability: AppAbility): TicketActor {
    return ticketActorOf(principal, ability, this.context.require().tenantId, this.tickets);
  }

  list(principal: Principal, ability: AppAbility, query: ListTicketsQuery): Promise<Page<TicketSummaryResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.tickets.list(tx, this.context.require().tenantId, [this.viewFilter(principal, query), readableTickets(ability)], pageWindow(query));
      return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
    });
  }

  timeline(ability: AppAbility, ticketId: string): Promise<TicketEventResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const events = await this.tickets.findTimeline(tx, this.context.require().tenantId, ticketId, readableTickets(ability));
      if (events === undefined) throw new NotFoundError();
      return events.map((event) => ({ ...event, data: event.data, createdAt: event.createdAt.toISOString() }));
    });
  }

  /** What the caller asked to look at; the ability filter narrows it further, never widens it. */
  private viewFilter(principal: Principal, query: ListTicketsQuery): Where {
    const status = query.status === undefined ? {} : { status: query.status };
    const context = { userId: principal.userId, membership: principal.membership };
    switch (query.view) {
      case 'created':
        return { ...status, ...createdBy(principal.userId) };
      case 'assigned':
        return { ...status, assignees: { some: { userId: principal.userId } } };
      case 'observed':
        return { ...status, ...observedBy(context) };
      case 'all':
        return status;
    }
  }
}
