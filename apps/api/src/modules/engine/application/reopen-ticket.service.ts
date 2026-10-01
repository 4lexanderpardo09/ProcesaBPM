import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidAssigneeError,
  InvalidErrorTypeError,
  InvalidReferenceError,
  InvalidStateError,
  PEOPLE_STEP_TYPES,
  PermissionDeniedError,
  type ReopenTicketRequest,
  TicketNotClosedError,
  type TicketMutationResponse,
  ValidationFailedError,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { AssignmentCandidatesRepository } from '../data/assignment-candidates.repository.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { lastHolders, reopenTarget } from '../domain/reopen-policy.js';
import type { EventPlan } from '../domain/plan.js';
import { arrivalEvents, ArrivalPlanner } from './arrival-planner.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';

/**
 * Reopens a closed ticket into a step it has been through: a new visit (the loop keeps counting; `max_loops`
 * does not apply), a fresh SLA, the last holders (or the step's own rule) and an error of a reopening type
 * recorded against whoever is responsible. The ticket row changes in one UPDATE, as `closed_at` is tied to
 * the status by an immediate check.
 */
@Injectable()
export class ReopenTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(AssignmentCandidatesRepository) private readonly candidates: AssignmentCandidatesRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  reopen(actor: TicketActor, ticketId: string, request: ReopenTicketRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const { ticket } = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      if (!(await actor.can(tx, ticketId, 'reopen'))) throw new PermissionDeniedError('Not allowed to reopen this ticket');
      if (ticket.status !== 'CLOSED') throw new TicketNotClosedError(ticket.status);

      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const peopleSteps = new Set(document.steps.filter((step) => PEOPLE_STEP_TYPES.has(step.type)).map((step) => step.id));
      const visits = await this.writes.findVisits(tx, tenantId, ticket.id);
      const stepId = reopenTarget(visits, peopleSteps, request.stepId);

      const reopenStep = document.steps.find((candidate) => candidate.id === stepId);
      // A parallel step asks its signers again: nobody can be put there by name, and nobody just "holds" it.
      if (reopenStep?.assignmentMode === 'PARALLEL' && request.assigneeId !== undefined) throw new InvalidAssigneeError();
      const errorType = await this.people.findReopeningErrorType(tx, tenantId, request.errorTypeId, request.errorSubtypeId);
      if (errorType === null) throw new InvalidErrorTypeError();
      const responsibleId = request.responsibleId ?? ticket.closedById;
      if (responsibleId === null) throw new InvalidReferenceError('Say who is responsible for the error: nobody is recorded as having closed the ticket');
      if (request.responsibleId !== undefined && (await this.people.findActiveMember(tx, tenantId, request.responsibleId)) === null) throw new InvalidReferenceError('The responsible person is not an active member');
      const description = sanitizeRichText(request.description);
      if (description === '') throw new ValidationFailedError([{ path: 'description', message: 'The description is empty' }]);

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const holders = await this.holdersOf(tx, tenantId, ticket.companyId, visits, stepId, request.assigneeId);
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: ticket.id,
        document,
        entryStepId: stepId,
        values: await this.loader.valuesOf(tx, tenantId, ticket.id, document),
        companyId: ticket.companyId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        calendar,
        at,
        chosenAssigneeId: undefined,
        holders,
        ignoreMaxLoops: true,
      });
      if (arrival.kind !== 'PEOPLE') throw new InvalidStateError('The step to reopen into is not a step for people');

      const errorId = await this.writes.insertTicketError(tx, tenantId, ticket.id, { errorTypeId: request.errorTypeId, errorSubtypeId: request.errorSubtypeId ?? null, reporterId: actor.userId, responsibleId, description, isProcessError: errorType.isProcessError, createdAt: at });
      const events: EventPlan[] = [
        {
          type: 'REOPENED',
          stepId,
          loop: arrival.plan.visit.loop,
          actorId: actor.userId,
          commentHtml: description,
          data: { errorId, errorTypeId: request.errorTypeId, responsibleId, previousClosedById: ticket.closedById, previousClosedAt: ticket.closedAt?.toISOString() ?? null },
          outbox: [{ type: 'ticket.reopened', payload: { errorId } }],
        },
        ...arrivalEvents(arrival, actor.userId, arrival.plan.visit.loop),
      ];
      const openVisitId = await this.applier.apply(tx, tenantId, { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId }, { at, actorId: actor.userId, fieldWrites: [], arrival: arrival.plan, ticket: { kind: 'reopened', stepId, loop: arrival.plan.visit.loop }, events });
      return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: stepId, openVisitId };
    });
  }

  /** The named person (an active member of the company), else the step's last holders who are still active; none means the step's own rule. */
  private async holdersOf(tx: Parameters<TicketContextRepository['findActiveMember']>[0], tenantId: string, companyId: string, visits: Awaited<ReturnType<TicketWriteRepository['findVisits']>>, stepId: string, assigneeId: string | undefined): Promise<string[]> {
    if (assigneeId !== undefined) {
      const named = await this.people.findActiveMember(tx, tenantId, assigneeId);
      if (named === null || !named.companyIds.includes(companyId)) throw new InvalidAssigneeError();
      return [named.userId];
    }
    const last = [...visits].filter((visit) => visit.stepId === stepId).at(-1);
    if (last === undefined) return [];
    const holders = lastHolders(await this.writes.findClocksOfVisit(tx, tenantId, last.id), last.exitedAt);
    return (await this.candidates.byUsers(tx, tenantId, holders)).map((row) => row.userId);
  }
}
