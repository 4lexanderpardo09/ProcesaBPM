import { Inject, Injectable } from '@nestjs/common';
import { InvalidErrorTypeError, InvalidStateError, PEOPLE_STEP_TYPES, type ReportTicketErrorRequest, type TicketMutationResponse, ValidationFailedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { AssignmentCandidatesRepository } from '../data/assignment-candidates.repository.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { EventPlan, TicketMutation } from '../domain/plan.js';
import { lastHolders } from '../domain/reopen-policy.js';
import { errorOutcome, previousPeopleVisit } from '../domain/report-error-policy.js';
import { reportErrorRefusal } from '../domain/ticket-action-rules.js';
import { arrivalEvents, ArrivalPlanner } from './arrival-planner.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';
import { TicketSlaService } from './ticket-sla.service.js';

/**
 * Reports an error on an open ticket and attributes it, as the help desk did: to whoever delivered the previous step
 * for people (the creator when there is none, or when the type forces the close). Depending on the type the ticket
 * stays (the error is only recorded), goes back to that step and person (a process error), or closes.
 */
@Injectable()
export class ReportTicketErrorService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(AssignmentCandidatesRepository) private readonly candidates: AssignmentCandidatesRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  report(actor: TicketActor, ticketId: string, request: ReportTicketErrorRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, actor);
      const refusal = reportErrorRefusal(await actor.can(tx, ticketId, 'report_error'));
      if (refusal !== null) throw refusal;
      const { ticket, visit } = current;

      const kind = await this.people.findReportableErrorType(tx, tenantId, request.errorTypeId, request.errorSubtypeId);
      if (kind === null) throw new InvalidErrorTypeError('Choose an active error type that is not for reopening');
      const description = sanitizeRichText(request.description);
      if (description === '') throw new ValidationFailedError([{ path: 'description', message: 'The description is empty' }]);

      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const peopleSteps = new Set(document.steps.filter((step) => PEOPLE_STEP_TYPES.has(step.type)).map((step) => step.id));
      const previous = previousPeopleVisit(await this.writes.findVisits(tx, tenantId, ticket.id), peopleSteps, visit.id);
      const previousHolder = previous === undefined ? undefined : await this.activeHolderOf(tx, tenantId, previous.id, previous.exitedAt);
      const responsibleId = kind.forcesClose || previousHolder === undefined ? ticket.creatorId : previousHolder;
      const outcome = errorOutcome(kind, previous, responsibleId === ticket.creatorId);

      const errorId = await this.writes.insertTicketError(tx, tenantId, ticket.id, {
        errorTypeId: request.errorTypeId,
        errorSubtypeId: request.errorSubtypeId ?? null,
        reporterId: actor.userId,
        responsibleId,
        description,
        isProcessError: kind.isProcessError,
        createdAt: at,
      });
      const reported: EventPlan = {
        type: 'ERROR_REPORTED',
        stepId: visit.stepId,
        loop: visit.loop,
        actorId: actor.userId,
        commentHtml: description,
        data: { errorId, errorTypeId: request.errorTypeId, responsibleId, outcome: outcome.kind, ...(outcome.kind === 'RETURN' ? { returnedToStepId: outcome.stepId } : {}) },
        outbox: [{ type: 'ticket.error_reported', payload: { errorId } }],
      };
      const target = { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId };
      const response = { id: ticket.id, number: ticket.number.toString() };

      if (outcome.kind === 'RECORD') {
        await this.applier.apply(tx, tenantId, target, { at, actorId: actor.userId, fieldWrites: [], ticket: { kind: 'unchanged' }, events: [reported] });
        return { ...response, status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
      }

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const closing = await this.sla.closeVisit(tx, tenantId, ticket.id, company, visit, current.clocks, at, null);
      if (outcome.kind === 'CLOSE') {
        const closed: EventPlan = { type: 'CLOSED', stepId: visit.stepId, loop: visit.loop, actorId: actor.userId, data: { reason: outcome.forced ? 'FORCED_BY_ERROR' : 'PROCESS_ERROR_ON_CREATOR', errorId }, outbox: [{ type: 'ticket.closed', payload: { closedById: actor.userId } }] };
        const mutation: TicketMutation = { at, actorId: actor.userId, fieldWrites: [], closing, ticket: { kind: 'closed', stepId: null, forced: outcome.forced }, events: [reported, closed] };
        await this.applier.apply(tx, tenantId, target, mutation);
        return { ...response, status: 'CLOSED', currentStepId: visit.stepId, openVisitId: null };
      }

      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: ticket.id,
        document,
        entryStepId: outcome.stepId,
        values: await this.loader.valuesOf(tx, tenantId, ticket.id, document),
        companyId: ticket.companyId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        calendar,
        timeZone: company.timeZone,
        at,
        chosenAssigneeId: undefined,
        holders: [responsibleId],
        ignoreMaxLoops: true,
      });
      if (arrival.kind !== 'PEOPLE') throw new InvalidStateError('The step to send the ticket back to is not a step for people');
      const loop = arrival.plan.visit.loop;
      await this.applier.apply(tx, tenantId, target, {
        at,
        actorId: actor.userId,
        fieldWrites: arrival.computed.fieldWrites,
        closing,
        arrival: arrival.plan,
        ticket: { kind: 'current', stepId: outcome.stepId, loop },
        events: [reported, ...arrivalEvents(arrival, actor.userId, loop)],
      });
      return { ...response, status: 'OPEN', currentStepId: outcome.stepId, openVisitId: null };
    });
  }

  /** Who delivered that visit and is still an active member to take the ticket back; none otherwise. */
  private async activeHolderOf(tx: TenantTransaction, tenantId: string, visitId: string, exitedAt: Date | null): Promise<string | undefined> {
    const holders = lastHolders(await this.writes.findClocksOfVisit(tx, tenantId, visitId), exitedAt);
    return (await this.candidates.byUsers(tx, tenantId, holders))[0]?.userId;
  }
}
