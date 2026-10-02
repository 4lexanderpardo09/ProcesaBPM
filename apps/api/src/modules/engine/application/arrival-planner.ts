import { Inject, Injectable } from '@nestjs/common';
import { type FormulaFailure, type RouteHop, routeThroughAutomaticBlocks, type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { openSla, type SlaTerms } from '../../sla/domain/clock-math.js';
import type { ResolvedCalendar } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { decideAssignees } from '../domain/assignment-policy.js';
import { nextLoop } from '../domain/loop-policy.js';
import { nextReopenLoop } from '../domain/reopen-policy.js';
import type { ArrivalPlan, AssigneeKind, ClockPlan, EventPlan, FieldWrite } from '../domain/plan.js';
import { AssignmentResolver } from './assignment-resolver.js';
import { ComputeEnvironment } from './compute-environment.js';

export interface ArrivalRequest {
  readonly tenantId: string;
  /** `null` while the ticket is being created: it has no visits yet. */
  readonly ticketId: string | null;
  readonly document: WorkflowVersionDocument;
  readonly entryStepId: string;
  /** Canonical values of the ticket after this submission: what conditions read. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly companyId: string;
  readonly siteId: string | null;
  readonly creatorId: string;
  readonly calendar: ResolvedCalendar | null;
  /** Time zone of the company: calculators and date formulas work with its local days. */
  readonly timeZone: string;
  readonly at: Date;
  readonly chosenAssigneeId: string | undefined;
  /** People who get the step as they are (a reopening gives it back to its last holders): the assignment mode is not asked. */
  readonly holders?: readonly string[];
  /** A deliberate reopening is not bound by the step's `max_loops`. */
  readonly ignoreMaxLoops?: boolean;
}

/** What the CALCULATOR blocks on the way changed in the ticket's values, and the calculators that failed. */
export interface ArrivalComputed {
  readonly fieldWrites: readonly FieldWrite[];
  readonly changes: ReadonlyArray<{ readonly code: string; readonly before: unknown; readonly after: unknown }>;
  readonly failures: readonly FormulaFailure[];
  /** The block that produced them (the history says where). */
  readonly stepId: string | undefined;
}

export type Arrival =
  | { readonly kind: 'END'; readonly hops: readonly RouteHop[]; readonly endStepId: string; readonly computed: ArrivalComputed }
  | { readonly kind: 'PEOPLE'; readonly hops: readonly RouteHop[]; readonly step: StepDocument; readonly plan: ArrivalPlan; readonly assigneeType: 'PRIMARY' | 'POOL' | 'PARALLEL' | 'DISPATCH'; readonly computed: ArrivalComputed }
  /** The ticket is parked on a WAIT block until `resumeAt`: a visit with nobody assigned and no clocks. */
  | { readonly kind: 'WAIT'; readonly hops: readonly RouteHop[]; readonly step: StepDocument; readonly plan: ArrivalPlan; readonly resumeAt: Date; readonly computed: ArrivalComputed };

const SIDE_EFFECT_OUTBOX: Readonly<Record<string, string>> = { DOCUMENT: 'block.document', NOTIFICATION: 'block.notification', WEBHOOK: 'block.webhook', EXPORT: 'block.export' };

/** The SLA that applies in a company: its override of the step, else the step's own. */
export function slaTermsOf(step: StepDocument, companyId: string): SlaTerms {
  const override = step.slaOverrides.find((candidate) => candidate.companyId === companyId);
  return override === undefined ? { value: step.slaValue, unit: step.slaUnit } : { value: override.slaValue, unit: override.slaUnit };
}

function computedOf(request: ArrivalRequest, route: ReturnType<typeof routeThroughAutomaticBlocks>): ArrivalComputed {
  const fieldIdOf = new Map(request.document.fields.map((field) => [field.code, field.id]));
  const changed = Object.entries(route.changed).filter(([code]) => fieldIdOf.has(code));
  return {
    fieldWrites: changed.map(([code, value]) => ({ fieldId: fieldIdOf.get(code)!, value })),
    changes: changed.map(([code, value]) => ({ code, before: request.values[code] ?? null, after: value })),
    failures: route.failures,
    stepId: route.hops.find((hop) => hop.blockType === 'CALCULATOR')?.stepId,
  };
}

/** The history of what automatic blocks computed: the values they set and the calculations that failed (all by the system, no actor). */
export function computedEvents(computed: ArrivalComputed, loop: number): EventPlan[] {
  if (computed.stepId === undefined) return [];
  const stepId = computed.stepId;
  return [
    ...(computed.changes.length === 0 ? [] : [{ type: 'FIELDS_UPDATED', stepId, loop, actorId: null, data: { changes: computed.changes, source: 'SYSTEM' } } satisfies EventPlan]),
    ...computed.failures.map((failure): EventPlan => ({ type: 'SYSTEM', stepId, loop, actorId: null, data: { kind: 'FORMULA_ERROR', fieldCode: failure.fieldCode, reason: failure.reason } })),
  ];
}

/** Events for the automatic blocks a ticket passed through (no visits: only people steps have them). */
export function hopEvents(hops: readonly RouteHop[], loop: number): EventPlan[] {
  return hops.map((hop) => ({
    type: 'TRANSITIONED',
    stepId: hop.stepId,
    transitionId: hop.transitionId,
    loop,
    actorId: null,
    data: { automatic: true, blockType: hop.blockType, ...hop.data },
    ...(SIDE_EFFECT_OUTBOX[hop.blockType] === undefined ? {} : { outbox: [{ type: SIDE_EFFECT_OUTBOX[hop.blockType]!, payload: { stepId: hop.stepId } }] }),
  }));
}

/**
 * Plans where a ticket goes after a submission: follows the automatic blocks to the next people step and
 * decides its loop, SLA, assignees and clocks. Pure of writes: every error (no branch, max loops, no
 * assignee, invalid choice) is raised here, before anything is changed.
 */
@Injectable()
export class ArrivalPlanner {
  constructor(
    @Inject(AssignmentResolver) private readonly resolver: AssignmentResolver,
    @Inject(TicketWriteRepository) private readonly tickets: TicketWriteRepository,
    @Inject(ComputeEnvironment) private readonly environments: ComputeEnvironment,
  ) {}

  private async signers(tx: TenantTransaction, request: ArrivalRequest, step: StepDocument) {
    const userIds = await this.resolver.signersFor(tx, step, { tenantId: request.tenantId, companyId: request.companyId, siteId: request.siteId, creatorId: request.creatorId, at: request.at });
    return { type: 'PARALLEL' as const, userIds };
  }

  private async decide(tx: TenantTransaction, request: ArrivalRequest, step: StepDocument) {
    const candidates = await this.resolver.candidatesFor(tx, step, { tenantId: request.tenantId, companyId: request.companyId, siteId: request.siteId, creatorId: request.creatorId, at: request.at });
    return decideAssignees({ stepId: step.id, mode: step.assignmentMode, manualSelection: step.manualSelection, candidates, chosenId: request.chosenAssigneeId });
  }

  /** A WAIT block holds the ticket without a person, an SLA or a loop limit: it is the clock of the workflow, not of anyone. */
  private park(request: ArrivalRequest, hops: readonly RouteHop[], step: StepDocument, resumeAt: Date, previousLoops: readonly number[], computed: ArrivalComputed): Arrival {
    const visit = { stepId: step.id, loop: nextReopenLoop(previousLoops), enteredAt: request.at, sla: { value: null, unit: null }, calendarId: null, dueAt: null, resumeAt };
    return { kind: 'WAIT', hops, step, resumeAt, computed, plan: { visit, clocks: [], assignees: [], parallelTasks: [] } };
  }

  async plan(tx: TenantTransaction, request: ArrivalRequest): Promise<Arrival> {
    const environment = await this.environments.build(tx, request.tenantId, request.document, { timeZone: request.timeZone, calendar: request.calendar, at: request.at });
    const route = routeThroughAutomaticBlocks(request.document, request.entryStepId, request.values, { ...environment, calendar: request.calendar?.calendar ?? null, at: request.at });
    const computed = computedOf(request, route);
    if (route.arrival.kind === 'END') return { kind: 'END', hops: route.hops, endStepId: route.arrival.stepId, computed };

    const step = request.document.steps.find((candidate) => candidate.id === route.arrival.stepId)!;
    const previousLoops = request.ticketId === null ? [] : await this.tickets.loopsOf(tx, request.tenantId, request.ticketId, step.id);
    if (route.arrival.kind === 'WAIT') return this.park(request, route.hops, step, route.arrival.resumeAt, previousLoops, computed);
    const loop = request.ignoreMaxLoops === true ? nextReopenLoop(previousLoops) : nextLoop(previousLoops, step.maxLoops, step.id);
    const sla = openSla(slaTermsOf(step, request.companyId), request.calendar?.calendar ?? null, request.at);
    const decision: { type: 'PRIMARY' | 'POOL' | 'PARALLEL' | 'DISPATCH'; userIds: readonly string[] } =
      request.holders !== undefined && request.holders.length > 0 && step.assignmentMode !== 'PARALLEL' ? { type: 'PRIMARY', userIds: request.holders } : step.assignmentMode === 'PARALLEL' ? await this.signers(tx, request, step) : await this.decide(tx, request, step);

    const clockBase = { startedAt: request.at, sla: { value: sla.value, unit: sla.unit }, calendarId: request.calendar?.id ?? null, dueAt: sla.dueAt };
    const clocks: ClockPlan[] = decision.type === 'POOL' || decision.type === 'DISPATCH' ? [{ ...clockBase, responsibleId: null }] : decision.userIds.map((userId) => ({ ...clockBase, responsibleId: userId }));
    return {
      kind: 'PEOPLE',
      hops: route.hops,
      computed,
      step,
      assigneeType: decision.type,
      plan: {
        visit: { stepId: step.id, loop, enteredAt: request.at, sla: { value: sla.value, unit: sla.unit }, calendarId: request.calendar?.id ?? null, dueAt: sla.dueAt },
        clocks,
        assignees: decision.type === 'DISPATCH' ? [] : decision.userIds.map((userId) => ({ userId, type: decision.type as AssigneeKind })),
        parallelTasks: decision.type === 'PARALLEL' ? decision.userIds : [],
      },
    };
  }
}

/** What the ticket's history and the outbox record about an arrival: the blocks passed, who was assigned, or the end. */
export function arrivalEvents(arrival: Arrival, actorId: string | null, hopLoop: number): EventPlan[] {
  const events = [...hopEvents(arrival.hops, hopLoop), ...computedEvents(arrival.computed, hopLoop)];
  if (arrival.kind === 'END') return events;
  if (arrival.kind === 'WAIT') return [...events, { type: 'SYSTEM', stepId: arrival.step.id, loop: arrival.plan.visit.loop, actorId: null, data: { kind: 'WAITING', resumeAt: arrival.resumeAt.toISOString() } }];
  const { step, plan, assigneeType } = arrival;
  if (assigneeType === 'DISPATCH') return [...events, { type: 'SYSTEM', stepId: step.id, loop: plan.visit.loop, actorId: null, data: { kind: 'AWAITING_DISPATCH' } }];
  return [
    ...events,
    ...plan.assignees.map(
      (assignee): EventPlan => ({
        type: 'ASSIGNED',
        stepId: step.id,
        loop: plan.visit.loop,
        actorId,
        assigneeId: assignee.userId,
        data: { assigneeType },
        outbox: [{ type: 'ticket.assigned', payload: { stepId: step.id, loop: plan.visit.loop, userId: assignee.userId, assigneeType } }],
      }),
    ),
  ];
}
