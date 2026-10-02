import { Inject, Injectable } from '@nestjs/common';
import { computeFieldValues, DomainError, type StepDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { EventPlan, FieldWrite, TicketMutation } from '../domain/plan.js';
import { arrivalEvents, ArrivalPlanner, computedEvents, type ArrivalComputed } from './arrival-planner.js';
import { ComputeEnvironment } from './compute-environment.js';
import { LockedTicketLoader } from './locked-ticket.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';
import { TicketSlaService } from './ticket-sla.service.js';

/** A wake-up that failed for a configuration reason (no one to assign, no branch…) is tried again after this long. */
export const WAIT_RETRY_MS = 60 * 60 * 1000;

export type ResumeOutcome = 'RESUMED' | 'IGNORED' | 'RESCHEDULED';

export interface WaitElapsed {
  readonly ticketId: string;
  readonly visitId: string;
}

/**
 * Wakes a ticket parked on a WAIT block: closes the parked visit, recalculates the computed fields and follows
 * the block's exit as if a person had moved it, with the system as the actor. It runs inside the transaction that
 * completes the `ticket.wait_elapsed` event and takes the ticket lock first, like every API action, so a duplicate
 * event or a ticket that was moved meanwhile finds the visit gone and does nothing.
 */
@Injectable()
export class ResumeWaitService {
  constructor(
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(ComputeEnvironment) private readonly environments: ComputeEnvironment,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  async resume(tx: TenantTransaction, tenantId: string, payload: WaitElapsed, at: Date): Promise<ResumeOutcome> {
    const ticket = await this.writes.lockTicket(tx, tenantId, payload.ticketId);
    if (ticket === undefined || ticket.status !== 'OPEN') return 'IGNORED';
    const visit = await this.writes.findOpenVisit(tx, tenantId, ticket.id);
    if (visit === null || visit.id !== payload.visitId || visit.resumeAt === null) return 'IGNORED';

    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const step = document.steps.find((candidate) => candidate.id === visit.stepId)!;
    const exit = document.transitions.find((transition) => transition.fromStepId === step.id && transition.type === 'DEFAULT');
    const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
    const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
    const existing = await this.loader.valuesOf(tx, tenantId, ticket.id, document);

    try {
      if (exit === undefined) throw new NoExitError();
      const recalculated = await this.recalculate(tx, tenantId, document, existing, { timeZone: company.timeZone, calendar, at });
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: ticket.id,
        document,
        entryStepId: exit.toStepId,
        values: { ...existing, ...recalculated.values },
        companyId: ticket.companyId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        calendar,
        timeZone: company.timeZone,
        at,
        chosenAssigneeId: undefined,
      });
      const closed = await this.sla.closeVisit(tx, tenantId, ticket.id, company, visit, [], at, exit.id);
      const events = this.events(step, exit.id, visit.loop, visit.resumeAt, recalculated.computed, arrival);
      const fieldWrites = [...recalculated.fieldWrites, ...arrival.computed.fieldWrites];
      const mutation: TicketMutation =
        arrival.kind === 'END'
          ? { at, actorId: null, fieldWrites, closing: closed, ticket: { kind: 'closed', stepId: arrival.endStepId }, events }
          : { at, actorId: null, fieldWrites, closing: closed, arrival: arrival.plan, ticket: { kind: 'current', stepId: arrival.step.id, loop: arrival.plan.visit.loop }, events };
      await this.applier.apply(tx, tenantId, { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId }, mutation);
      return 'RESUMED';
    } catch (error) {
      if (!(error instanceof DomainError) && !(error instanceof NoExitError)) throw error;
      await this.reschedule(tx, tenantId, ticket.id, visit, step.id, error instanceof NoExitError ? 'NO_EXIT' : error.code, at);
      return 'RESCHEDULED';
    }
  }

  /** Computed fields are recalculated when the ticket wakes: a date formula may read today's date. Failures are recorded, never fatal. */
  private async recalculate(tx: TenantTransaction, tenantId: string, document: Parameters<ComputeEnvironment['build']>[2], existing: Readonly<Record<string, unknown>>, source: Parameters<ComputeEnvironment['build']>[3]) {
    const environment = await this.environments.build(tx, tenantId, document, source);
    const result = computeFieldValues(document.fields, existing, environment);
    const fieldIdOf = new Map(document.fields.map((field) => [field.code, field.id]));
    const changed = Object.entries(result.values).filter(([code, value]) => JSON.stringify(existing[code] ?? null) !== JSON.stringify(value ?? null));
    const fieldWrites: FieldWrite[] = changed.map(([code, value]) => ({ fieldId: fieldIdOf.get(code)!, value }));
    const computed: ArrivalComputed = {
      fieldWrites,
      changes: changed.map(([code, value]) => ({ code, before: existing[code] ?? null, after: value })),
      failures: result.failures.filter((failure) => existing[failure.fieldCode] !== null && existing[failure.fieldCode] !== undefined),
      stepId: undefined,
    };
    return { values: result.values, fieldWrites, computed };
  }

  private events(step: StepDocument, exitId: string, loop: number, waitedUntil: Date, recalculated: ArrivalComputed, arrival: Awaited<ReturnType<ArrivalPlanner['plan']>>): EventPlan[] {
    return [
      ...computedEvents({ ...recalculated, stepId: step.id }, loop),
      { type: 'TRANSITIONED', stepId: step.id, transitionId: exitId, loop, actorId: null, data: { automatic: true, blockType: 'WAIT', waitedUntil: waitedUntil.toISOString() } },
      ...arrivalEvents(arrival, null, loop),
      ...(arrival.kind === 'END' ? [{ type: 'CLOSED', stepId: arrival.endStepId, loop, actorId: null, data: { reason: 'WORKFLOW_ENDED' }, outbox: [{ type: 'ticket.closed', payload: { closedById: null } }] } satisfies EventPlan] : []),
    ];
  }

  private async reschedule(tx: TenantTransaction, tenantId: string, ticketId: string, visit: { readonly id: string; readonly loop: number }, stepId: string, code: string, at: Date): Promise<void> {
    await this.writes.rescheduleWait(tx, tenantId, visit.id, new Date(at.getTime() + WAIT_RETRY_MS));
    await this.writes.insertEvent(tx, tenantId, ticketId, at, { type: 'SYSTEM', stepId, loop: visit.loop, actorId: null, data: { kind: 'WAIT_RESUME_FAILED', code } });
  }
}

class NoExitError extends Error {}
