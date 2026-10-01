import { Inject, Injectable } from '@nestjs/common';
import { type RouteHop, routeThroughAutomaticBlocks, type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { openSla, type SlaTerms } from '../../sla/domain/clock-math.js';
import type { ResolvedCalendar } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { decideAssignees } from '../domain/assignment-policy.js';
import { nextLoop } from '../domain/loop-policy.js';
import { nextReopenLoop } from '../domain/reopen-policy.js';
import type { ArrivalPlan, ClockPlan, EventPlan } from '../domain/plan.js';
import { AssignmentResolver } from './assignment-resolver.js';

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
  readonly at: Date;
  readonly chosenAssigneeId: string | undefined;
  /** People who get the step as they are (a reopening gives it back to its last holders): the assignment mode is not asked. */
  readonly holders?: readonly string[];
  /** A deliberate reopening is not bound by the step's `max_loops`. */
  readonly ignoreMaxLoops?: boolean;
}

export type Arrival =
  | { readonly kind: 'END'; readonly hops: readonly RouteHop[]; readonly endStepId: string }
  | { readonly kind: 'PEOPLE'; readonly hops: readonly RouteHop[]; readonly step: StepDocument; readonly plan: ArrivalPlan; readonly assigneeType: 'PRIMARY' | 'POOL' };

const SIDE_EFFECT_OUTBOX: Readonly<Record<string, string>> = { DOCUMENT: 'block.document', NOTIFICATION: 'block.notification', WEBHOOK: 'block.webhook', EXPORT: 'block.export' };

/** The SLA that applies in a company: its override of the step, else the step's own. */
export function slaTermsOf(step: StepDocument, companyId: string): SlaTerms {
  const override = step.slaOverrides.find((candidate) => candidate.companyId === companyId);
  return override === undefined ? { value: step.slaValue, unit: step.slaUnit } : { value: override.slaValue, unit: override.slaUnit };
}

/** Events for the automatic blocks a ticket passed through (no visits: only people steps have them). */
export function hopEvents(hops: readonly RouteHop[], loop: number): EventPlan[] {
  return hops.map((hop) => ({
    type: 'TRANSITIONED',
    stepId: hop.stepId,
    transitionId: hop.transitionId,
    loop,
    actorId: null,
    data: { automatic: true, blockType: hop.blockType },
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
  ) {}

  private async decide(tx: TenantTransaction, request: ArrivalRequest, step: StepDocument) {
    const candidates = await this.resolver.candidatesFor(tx, step, { tenantId: request.tenantId, companyId: request.companyId, siteId: request.siteId, creatorId: request.creatorId, at: request.at });
    return decideAssignees({ stepId: step.id, mode: step.assignmentMode, manualSelection: step.manualSelection, candidates, chosenId: request.chosenAssigneeId });
  }

  async plan(tx: TenantTransaction, request: ArrivalRequest): Promise<Arrival> {
    const route = routeThroughAutomaticBlocks(request.document, request.entryStepId, request.values);
    if (route.arrival.kind === 'END') return { kind: 'END', hops: route.hops, endStepId: route.arrival.stepId };

    const step = request.document.steps.find((candidate) => candidate.id === route.arrival.stepId)!;
    const previousLoops = request.ticketId === null ? [] : await this.tickets.loopsOf(tx, request.tenantId, request.ticketId, step.id);
    const loop = request.ignoreMaxLoops === true ? nextReopenLoop(previousLoops) : nextLoop(previousLoops, step.maxLoops, step.id);
    const sla = openSla(slaTermsOf(step, request.companyId), request.calendar?.calendar ?? null, request.at);
    const decision = request.holders !== undefined && request.holders.length > 0 ? ({ type: 'PRIMARY', userIds: request.holders } as const) : await this.decide(tx, request, step);

    const clockBase = { startedAt: request.at, sla: { value: sla.value, unit: sla.unit }, calendarId: request.calendar?.id ?? null, dueAt: sla.dueAt };
    const clocks: ClockPlan[] = decision.type === 'POOL' ? [{ ...clockBase, responsibleId: null }] : decision.userIds.map((userId) => ({ ...clockBase, responsibleId: userId }));
    return {
      kind: 'PEOPLE',
      hops: route.hops,
      step,
      assigneeType: decision.type,
      plan: {
        visit: { stepId: step.id, loop, enteredAt: request.at, sla: { value: sla.value, unit: sla.unit }, calendarId: request.calendar?.id ?? null, dueAt: sla.dueAt },
        clocks,
        assignees: decision.userIds.map((userId) => ({ userId, type: decision.type })),
      },
    };
  }
}

/** What the ticket's history and the outbox record about an arrival: the blocks passed, who was assigned, or the end. */
export function arrivalEvents(arrival: Arrival, actorId: string | null, hopLoop: number): EventPlan[] {
  const events = hopEvents(arrival.hops, hopLoop);
  if (arrival.kind === 'END') return events;
  const { step, plan, assigneeType } = arrival;
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
