import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
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
}

export interface OpenClockRow {
  readonly id: string;
  readonly responsibleId: string | null;
  readonly startedAt: Date;
  readonly dueAt: Date | null;
  readonly calendarId: string | null;
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
             creator_id::text AS "creatorId", site_id::text AS "siteId"
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
      select: { id: true, stepId: true, loop: true, enteredAt: true, dueAt: true, slaValue: true, slaUnit: true, calendarId: true },
    });
  }

  findOpenClocks(tx: TenantTransaction, tenantId: string, visitId: string): Promise<OpenClockRow[]> {
    return tx.ticketSlaClock.findMany({ where: { tenantId, visitId, completedAt: null }, select: { id: true, responsibleId: true, startedAt: true, dueAt: true, calendarId: true }, orderBy: { id: 'asc' } });
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
        data: { completedAt, businessMinutes: clock.businessMinutes, result: clock.result },
      });
    }
  }

  async closeVisit(tx: TenantTransaction, tenantId: string, exitedAt: Date, visit: ClosedVisit): Promise<void> {
    await tx.ticketStepVisit.updateMany({
      where: { tenantId, id: visit.visitId, exitedAt: null },
      data: { exitedAt, exitTransitionId: visit.exitTransitionId, businessMinutes: visit.businessMinutes, result: visit.result },
    });
  }

  async deleteAssignees(tx: TenantTransaction, tenantId: string, ticketId: string, userIds?: readonly string[]): Promise<void> {
    await tx.ticketAssignee.deleteMany({ where: { tenantId, ticketId, ...(userIds === undefined ? {} : { userId: { in: [...userIds] } }) } });
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
