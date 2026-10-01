import { Inject, Injectable } from '@nestjs/common';
import { InvalidReferenceError, InvalidTransitionError, plainTextToHtml, type TicketMutationResponse, type TransitionTicketRequest } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { EventPlan, TicketMutation } from '../domain/plan.js';
import { arrivalEvents, ArrivalPlanner } from './arrival-planner.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { diversionEdge, SubmissionValidator } from './submission-validator.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';
import { TicketSlaService } from './ticket-sla.service.js';

/**
 * Advances a ticket along a DECISION transition of its current step: validates the step's fields and amount
 * caps, closes the responsible's clock and the visit, follows the automatic blocks to the next people step
 * and opens its visit, clocks and assignees. The ticket row is locked first, so two simultaneous
 * transitions queue and the second one finds the step already changed (409).
 */
@Injectable()
export class TransitionTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(SubmissionValidator) private readonly submissions: SubmissionValidator,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  transition(actor: TicketActor, ticketId: string, request: TransitionTicketRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, actor);
      this.loader.assertMayAct(current, actor);
      const { ticket, visit } = current;

      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const chosen = document.transitions.find((transition) => transition.id === request.transitionId);
      const step = document.steps.find((candidate) => candidate.id === ticket.currentStepId);
      if (chosen === undefined || step === undefined || chosen.fromStepId !== step.id || chosen.type !== 'DECISION') throw new InvalidTransitionError();

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const actorMember = await this.people.findActiveMember(tx, tenantId, actor.userId);
      const existing = await this.loader.valuesOf(tx, tenantId, ticket.id, document);
      const submission = await this.submissions.validate(tx, {
        tenantId,
        document,
        stage: 'STEP',
        step,
        input: request.values,
        existing,
        company,
        positionId: actorMember?.positionId ?? null,
        at,
      });

      const diversion = diversionEdge(document, submission.amounts, step.id);
      const diverted = diversion !== undefined && !(await this.writes.hasVisited(tx, tenantId, ticket.id, diversion.toStepId));
      const exit = diverted ? { transitionId: diversion.transitionId, toStepId: diversion.toStepId } : { transitionId: chosen.id, toStepId: chosen.toStepId };
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: ticket.id,
        document,
        entryStepId: exit.toStepId,
        values: submission.merged,
        companyId: ticket.companyId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        calendar,
        at,
        chosenAssigneeId: request.assigneeId,
      });
      if (request.assigneeId !== undefined && arrival.kind === 'END') throw new InvalidReferenceError('The ticket ends here: there is nobody to assign');

      const closed = await this.sla.closeVisit(tx, tenantId, company, visit, current.clocks, at, exit.transitionId);
      const events: EventPlan[] = [
        ...(submission.changes.length === 0 ? [] : [{ type: 'FIELDS_UPDATED', stepId: step.id, loop: visit.loop, actorId: actor.userId, data: { changes: submission.changes } } satisfies EventPlan]),
        ...submission.amounts.warnings.map((warning): EventPlan => ({ type: 'AMOUNT_WARNING', stepId: step.id, loop: visit.loop, actorId: actor.userId, data: { ...warning } })),
        {
          type: 'TRANSITIONED',
          stepId: step.id,
          transitionId: exit.transitionId,
          loop: visit.loop,
          actorId: actor.userId,
          commentHtml: request.comment === undefined ? null : plainTextToHtml(request.comment),
          data: { ...(diverted ? { intendedTransitionId: chosen.id, amountRuleId: diversion.ruleId } : {}), ...(current.actorIsPoolMember ? { tookFromPool: true } : {}) },
          outbox: [{ type: 'ticket.transitioned', payload: { fromStepId: step.id, toStepId: exit.toStepId, transitionId: exit.transitionId, actorId: actor.userId } }],
        },
        ...arrivalEvents(arrival, actor.userId, visit.loop),
        ...(arrival.kind === 'END' ? [{ type: 'CLOSED', stepId: arrival.endStepId, loop: visit.loop, actorId: actor.userId, data: { reason: 'WORKFLOW_ENDED' }, outbox: [{ type: 'ticket.closed', payload: { closedById: actor.userId } }] } satisfies EventPlan] : []),
      ];
      const mutation: TicketMutation =
        arrival.kind === 'END'
          ? { at, actorId: actor.userId, fieldWrites: submission.fieldWrites, closing: closed, ticket: { kind: 'closed', stepId: arrival.endStepId }, events }
          : { at, actorId: actor.userId, fieldWrites: submission.fieldWrites, closing: closed, arrival: arrival.plan, ticket: { kind: 'current', stepId: arrival.step.id, loop: arrival.plan.visit.loop }, events };
      const openVisitId = await this.applier.apply(tx, tenantId, { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId }, mutation);
      return { id: ticket.id, number: ticket.number.toString(), status: arrival.kind === 'END' ? 'CLOSED' : 'OPEN', currentStepId: arrival.kind === 'END' ? arrival.endStepId : arrival.step.id, openVisitId };
    });
  }
}
