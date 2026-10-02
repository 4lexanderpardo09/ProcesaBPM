import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { IncidentPeriod } from '../../sla/domain/pause-math.js';
import type { AssigneePlan, ClockPlan, ClosedClock, ClosedVisit, EventPlan, FieldWrite, VisitPlan } from '../domain/plan.js';

export interface LockedTicket {
  readonly id: string;
  readonly number: bigint;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly workflowVersionId: string;
  readonly currentStepId: string | null;
  readonly currentLoop: number;
  readonly companyId: string;
  readonly creatorId: string;
  readonly siteId: string | null;
  readonly closedById: string | null;
  readonly closedAt: Date | null;
}

export interface OpenVisitRow {
  readonly id: string;
  readonly stepId: string;
  readonly loop: number;
  readonly enteredAt: Date;
  readonly dueAt: Date | null;
  readonly slaValue: number | null;
  readonly slaUnit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS' | null;
  readonly calendarId: string | null;
  readonly pausedMinutes: number;
}

export interface OpenClockRow {
  readonly id: string;
  readonly responsibleId: string | null;
  readonly startedAt: Date;
  readonly dueAt: Date | null;
  readonly calendarId: string | null;
  readonly slaValue: number | null;
  readonly slaUnit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS' | null;
  readonly pausedAt: Date | null;
  readonly pausedMinutes: number;
}

export interface ParallelTaskRow {
  readonly id: string;
  readonly userId: string;
  readonly status: 'PENDING' | 'SIGNED' | 'REJECTED' | 'CANCELLED';
}

export interface IncidentRow {
  readonly id: string;
  readonly stepId: string;
  readonly createdById: string;
  readonly assignedToId: string;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly previousAssigneeIds: string[];
  readonly openedAt: Date;
}

export interface NewTicket {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly subcategoryId: string;
  readonly priorityId: string | null;
  readonly companyId: string;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly creatorId: string;
  readonly registeredById: string | null;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly currentStepId: string;
  readonly currentLoop: number;
  readonly createdAt: Date;
}

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Every write of the ticket aggregate. Callers hold the ticket's row lock; every query carries the tenant. */
@Injectable()
export class TicketWriteRepository {
  /** The ticket row, locked until the transaction ends. Everything that changes a ticket starts here. */
  async lockTicket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<LockedTicket | undefined> {
    const rows = await tx.$queryRaw<LockedTicket[]>`
      SELECT id::text AS "id", number, status::text AS "status", workflow_version_id::text AS "workflowVersionId",
             current_step_id::text AS "currentStepId", current_loop AS "currentLoop", company_id::text AS "companyId",
             creator_id::text AS "creatorId", site_id::text AS "siteId",
             closed_by_id::text AS "closedById", closed_at AS "closedAt"
      FROM tickets
      WHERE tenant_id = ${tenantId}::uuid AND id = ${ticketId}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    return rows[0];
  }

  async nextNumber(tx: TenantTransaction): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ number: bigint }>>`SELECT next_tenant_sequence('ticket') AS "number"`;
    return rows[0]!.number;
  }

  async insertTicket(tx: TenantTransaction, tenantId: string, number: bigint, ticket: NewTicket): Promise<string> {
    const created = await tx.ticket.create({
      data: {
        tenantId,
        number,
        workflowId: ticket.workflowId,
        workflowVersionId: ticket.workflowVersionId,
        subcategoryId: ticket.subcategoryId,
        priorityId: ticket.priorityId,
        companyId: ticket.companyId,
        departmentId: ticket.departmentId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        registeredById: ticket.registeredById,
        title: ticket.title,
        descriptionHtml: ticket.descriptionHtml,
        status: 'OPEN',
        currentStepId: ticket.currentStepId,
        currentLoop: ticket.currentLoop,
        createdAt: ticket.createdAt,
      },
      select: { id: true },
    });
    return created.id;
  }

  async findOpenVisit(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<OpenVisitRow | null> {
    return tx.ticketStepVisit.findFirst({
      where: { tenantId, ticketId, exitedAt: null },
      select: { id: true, stepId: true, loop: true, enteredAt: true, dueAt: true, slaValue: true, slaUnit: true, calendarId: true, pausedMinutes: true },
    });
  }

  findOpenClocks(tx: TenantTransaction, tenantId: string, visitId: string): Promise<OpenClockRow[]> {
    return tx.ticketSlaClock.findMany({ where: { tenantId, visitId, completedAt: null }, select: { id: true, responsibleId: true, startedAt: true, dueAt: true, calendarId: true, slaValue: true, slaUnit: true, pausedAt: true, pausedMinutes: true }, orderBy: { id: 'asc' } });
  }

  findAssignees(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<Array<{ userId: string; type: 'PRIMARY' | 'POOL' | 'PARALLEL' | 'INCIDENT' }>> {
    return tx.ticketAssignee.findMany({ where: { tenantId, ticketId }, select: { userId: true, type: true }, orderBy: { userId: 'asc' } });
  }

  async loopsOf(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string): Promise<number[]> {
    const rows = await tx.ticketStepVisit.findMany({ where: { tenantId, ticketId, stepId }, select: { loop: true } });
    return rows.map((row) => row.loop);
  }

  /** Whether the ticket already left the step before (the extra approval is not asked twice). */
  async hasVisited(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string): Promise<boolean> {
    return (await tx.ticketStepVisit.count({ where: { tenantId, ticketId, stepId, exitedAt: { not: null } } })) > 0;
  }

  /** Every incident of the ticket, as the periods its clocks stood still. */
  async findIncidentPeriods(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<IncidentPeriod[]> {
    return tx.ticketIncident.findMany({ where: { tenantId, ticketId }, select: { openedAt: true, resolvedAt: true }, orderBy: { openedAt: 'asc' } });
  }

  /** Every visit of the ticket, oldest first. */
  findVisits(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<Array<{ id: string; stepId: string; loop: number; enteredAt: Date; exitedAt: Date | null }>> {
    return tx.ticketStepVisit.findMany({ where: { tenantId, ticketId }, select: { id: true, stepId: true, loop: true, enteredAt: true, exitedAt: true }, orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }] });
  }

  findClocksOfVisit(tx: TenantTransaction, tenantId: string, visitId: string): Promise<Array<{ responsibleId: string | null; completedAt: Date | null }>> {
    return tx.ticketSlaClock.findMany({ where: { tenantId, visitId }, select: { responsibleId: true, completedAt: true } });
  }

  /** One UPDATE: the check that ties `closed_at` to the status is immediate. */
  async reopenTicket(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string, loop: number): Promise<void> {
    await tx.ticket.updateMany({ where: { tenantId, id: ticketId }, data: { status: 'OPEN', closedAt: null, closedById: null, forcedClose: false, currentStepId: stepId, currentLoop: loop } });
  }

  async insertTicketError(tx: TenantTransaction, tenantId: string, ticketId: string, error: { errorTypeId: string; errorSubtypeId: string | null; reporterId: string; responsibleId: string; description: string; isProcessError: boolean; createdAt: Date }): Promise<string> {
    const created = await tx.ticketError.create({ data: { tenantId, ticketId, ...error }, select: { id: true } });
    return created.id;
  }

  async insertParallelTasks(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string, loop: number, userIds: readonly string[]): Promise<void> {
    await tx.ticketParallelTask.createMany({ data: userIds.map((userId) => ({ tenantId, ticketId, stepId, loop, userId })) });
  }

  findParallelTasks(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string, loop: number): Promise<ParallelTaskRow[]> {
    return tx.ticketParallelTask.findMany({ where: { tenantId, ticketId, stepId, loop }, select: { id: true, userId: true, status: true }, orderBy: { id: 'asc' } });
  }

  /** The task leaves PENDING: a database trigger then removes the signer's PARALLEL assignee row. */
  async completeParallelTask(tx: TenantTransaction, tenantId: string, taskId: string, status: 'SIGNED' | 'REJECTED' | 'CANCELLED', completedAt: Date, comment: string | null): Promise<void> {
    await tx.ticketParallelTask.updateMany({ where: { tenantId, id: taskId, status: 'PENDING' }, data: { status, completedAt, comment } });
  }

  async moveParallelTask(tx: TenantTransaction, tenantId: string, taskId: string, toUserId: string): Promise<void> {
    await tx.ticketParallelTask.updateMany({ where: { tenantId, id: taskId, status: 'PENDING' }, data: { userId: toUserId } });
  }

  /** How many tickets each person holds right now (to spread positions' signatures). */
  async assignmentLoads(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.ticketAssignee.groupBy({ by: ['userId'], where: { tenantId, userId: { in: [...userIds] } }, _count: { _all: true } });
    return new Map(rows.map((row) => [row.userId, row._count._all]));
  }

  /** The clocks of the visit that are running stand still from `at`. */
  async pauseClocks(tx: TenantTransaction, tenantId: string, visitId: string, at: Date): Promise<void> {
    await tx.ticketSlaClock.updateMany({ where: { tenantId, visitId, completedAt: null, pausedAt: null }, data: { pausedAt: at } });
  }

  /** A paused clock runs again with the due date and the paused minutes the resume math gave it. */
  async resumeClock(tx: TenantTransaction, tenantId: string, clockId: string, resumed: { pausedMinutes: number; dueAt: Date | null }): Promise<void> {
    await tx.ticketSlaClock.updateMany({ where: { tenantId, id: clockId, completedAt: null }, data: { pausedAt: null, pausedMinutes: resumed.pausedMinutes, dueAt: resumed.dueAt } });
  }

  /** A clock whose responsible is gone goes back to waiting for a dispatch: it keeps running, with nobody's name on it. */
  async releaseClock(tx: TenantTransaction, tenantId: string, clockId: string): Promise<void> {
    await tx.ticketSlaClock.updateMany({ where: { tenantId, id: clockId, completedAt: null }, data: { responsibleId: null } });
  }

  async updateVisitPause(tx: TenantTransaction, tenantId: string, visitId: string, resumed: { pausedMinutes: number; dueAt: Date | null }): Promise<void> {
    await tx.ticketStepVisit.updateMany({ where: { tenantId, id: visitId, exitedAt: null }, data: { pausedMinutes: resumed.pausedMinutes, dueAt: resumed.dueAt } });
  }

  async insertIncident(tx: TenantTransaction, tenantId: string, ticketId: string, incident: { stepId: string; createdById: string; assignedToId: string; description: string; previousAssigneeIds: readonly string[]; openedAt: Date }): Promise<string> {
    const created = await tx.ticketIncident.create({
      data: { tenantId, ticketId, stepId: incident.stepId, createdById: incident.createdById, assignedToId: incident.assignedToId, description: incident.description, previousAssigneeIds: [...incident.previousAssigneeIds], openedAt: incident.openedAt },
      select: { id: true },
    });
    return created.id;
  }

  findIncident(tx: TenantTransaction, tenantId: string, ticketId: string, incidentId: string): Promise<IncidentRow | null> {
    return tx.ticketIncident.findFirst({ where: { tenantId, ticketId, id: incidentId }, select: { id: true, stepId: true, createdById: true, assignedToId: true, status: true, previousAssigneeIds: true, openedAt: true } });
  }

  /** One UPDATE: the check that ties `resolved_at` to the status is immediate. */
  async resolveIncident(tx: TenantTransaction, tenantId: string, incidentId: string, resolvedAt: Date, resolution: string): Promise<void> {
    await tx.ticketIncident.updateMany({ where: { tenantId, id: incidentId, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt, resolution } });
  }

  async setTicketStatus(tx: TenantTransaction, tenantId: string, ticketId: string, status: 'OPEN' | 'PAUSED'): Promise<void> {
    await tx.ticket.updateMany({ where: { tenantId, id: ticketId }, data: { status } });
  }

  /** People with a pending parallel task in the step and loop. */
  async pendingSignerIds(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string, loop: number): Promise<Set<string>> {
    const rows = await tx.ticketParallelTask.findMany({ where: { tenantId, ticketId, stepId, loop, status: 'PENDING' }, select: { userId: true } });
    return new Set(rows.map((row) => row.userId));
  }

  /** Stored values keyed by field id. */
  async storedValues(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<Map<string, unknown>> {
    const rows = await tx.ticketFieldValue.findMany({ where: { tenantId, ticketId }, select: { fieldId: true, value: true } });
    return new Map(rows.map((row) => [row.fieldId, row.value]));
  }

  async upsertFieldValues(tx: TenantTransaction, tenantId: string, ticketId: string, versionId: string, actorId: string, writes: readonly FieldWrite[]): Promise<void> {
    for (const write of writes) {
      await tx.ticketFieldValue.upsert({
        where: { tenantId_ticketId_fieldId: { tenantId, ticketId, fieldId: write.fieldId } },
        create: { tenantId, ticketId, workflowVersionId: versionId, fieldId: write.fieldId, value: json(write.value), updatedById: actorId },
        update: { value: json(write.value), updatedById: actorId },
      });
    }
  }

  async closeClocks(tx: TenantTransaction, tenantId: string, completedAt: Date, clocks: readonly ClosedClock[]): Promise<void> {
    for (const clock of clocks) {
      await tx.ticketSlaClock.updateMany({
        where: { tenantId, id: clock.clockId, completedAt: null },
        data: { completedAt, businessMinutes: clock.businessMinutes, result: clock.result, completionReason: clock.reason },
      });
    }
  }

  async closeVisit(tx: TenantTransaction, tenantId: string, exitedAt: Date, visit: ClosedVisit): Promise<void> {
    await tx.ticketStepVisit.updateMany({
      where: { tenantId, id: visit.visitId, exitedAt: null },
      data: { exitedAt, exitTransitionId: visit.exitTransitionId, businessMinutes: visit.businessMinutes, result: visit.result },
    });
  }

  /** Whether the person was ever assigned to the ticket (its events keep the record). */
  async wasAssigned(tx: TenantTransaction, tenantId: string, ticketId: string, userId: string): Promise<boolean> {
    return (await tx.ticketEvent.count({ where: { tenantId, ticketId, assigneeId: userId, type: { in: ['ASSIGNED', 'REASSIGNED'] } } })) > 0;
  }

  async deleteAssignees(tx: TenantTransaction, tenantId: string, ticketId: string, userId?: string): Promise<void> {
    await tx.ticketAssignee.deleteMany({ where: { tenantId, ticketId, ...(userId === undefined ? {} : { userId }) } });
  }

  async insertAssignees(tx: TenantTransaction, tenantId: string, ticketId: string, assignedAt: Date, assignees: readonly AssigneePlan[]): Promise<void> {
    await tx.ticketAssignee.createMany({ data: assignees.map((assignee) => ({ tenantId, ticketId, userId: assignee.userId, type: assignee.type, assignedAt })) });
  }

  async insertVisit(tx: TenantTransaction, tenantId: string, ticketId: string, visit: VisitPlan): Promise<string> {
    const created = await tx.ticketStepVisit.create({
      data: {
        tenantId,
        ticketId,
        stepId: visit.stepId,
        loop: visit.loop,
        enteredAt: visit.enteredAt,
        slaValue: visit.sla.value,
        slaUnit: visit.sla.unit,
        calendarId: visit.calendarId,
        dueAt: visit.dueAt,
      },
      select: { id: true },
    });
    return created.id;
  }

  async insertClocks(tx: TenantTransaction, tenantId: string, ticket: { id: string; companyId: string }, visitId: string, visit: VisitPlan, clocks: readonly ClockPlan[]): Promise<void> {
    await tx.ticketSlaClock.createMany({
      data: clocks.map((clock) => ({
        tenantId,
        ticketId: ticket.id,
        visitId,
        stepId: visit.stepId,
        loop: visit.loop,
        companyId: ticket.companyId,
        responsibleId: clock.responsibleId,
        slaValue: clock.sla.value,
        slaUnit: clock.sla.unit,
        calendarId: clock.calendarId,
        startedAt: clock.startedAt,
        dueAt: clock.dueAt,
      })),
    });
  }

  /** A pool clock gets its responsible when someone takes the ticket; it keeps running. */
  async assignClockResponsible(tx: TenantTransaction, tenantId: string, clockId: string, responsibleId: string): Promise<void> {
    await tx.ticketSlaClock.updateMany({ where: { tenantId, id: clockId, completedAt: null, responsibleId: null }, data: { responsibleId } });
  }

  async moveTicket(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string, loop: number): Promise<void> {
    await tx.ticket.updateMany({ where: { tenantId, id: ticketId }, data: { currentStepId: stepId, currentLoop: loop } });
  }

  /** One UPDATE: the check that ties `closed_at` to the status is immediate. */
  async closeTicket(tx: TenantTransaction, tenantId: string, ticketId: string, closedAt: Date, closedById: string, stepId: string | null): Promise<void> {
    await tx.ticket.updateMany({ where: { tenantId, id: ticketId }, data: { status: 'CLOSED', closedAt, closedById, ...(stepId === null ? {} : { currentStepId: stepId }) } });
  }

  /** Inserts the event and its outbox work in order; returns the event id. */
  async insertEvent(tx: TenantTransaction, tenantId: string, ticketId: string, at: Date, event: EventPlan): Promise<string> {
    const created = await tx.ticketEvent.create({
      data: {
        tenantId,
        ticketId,
        type: event.type,
        stepId: event.stepId ?? null,
        transitionId: event.transitionId ?? null,
        loop: event.loop,
        actorId: event.actorId,
        assigneeId: event.assigneeId ?? null,
        commentHtml: event.commentHtml ?? null,
        ...(event.data === undefined ? {} : { data: json(event.data) }),
        createdAt: at,
      },
      select: { id: true },
    });
    for (const work of event.outbox ?? []) {
      await tx.outboxEvent.create({ data: { tenantId, type: work.type, payload: json({ ...work.payload, ticketId, eventId: created.id }) } });
    }
    return created.id;
  }
}
