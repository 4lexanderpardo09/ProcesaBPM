import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateTicketRequest,
  InitiatorNotAllowedError,
  InvalidReferenceError,
  NotFoundError,
  PermissionDeniedError,
  type StepDocument,
  type TicketMutationResponse,
  WorkflowNotAvailableError,
} from '@procesabpm/shared';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader, type PublishedWorkflow } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { EventPlan, TicketMutation } from '../domain/plan.js';
import { type Arrival, ArrivalPlanner, arrivalEvents } from './arrival-planner.js';
import { assertRunnable, CreationGate } from './creation-gate.js';
import { attachmentsPlanOf } from './submission-files.js';
import { diversionEdge, formulaFailureEvents, SubmissionValidator } from './submission-validator.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';

export interface TicketCreator {
  readonly userId: string;
  /** Whether the permission covers a ticket with these attributes (stored conditions may narrow it). */
  readonly mayCreate: (action: 'create' | 'create_for_others', record: NewTicketRecord) => boolean;
}

export interface NewTicketRecord {
  readonly companyId: string;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly subcategoryId: string;
  readonly workflowId: string;
  readonly priorityId: string | null;
  readonly creatorId: string;
}

/**
 * Creates a ticket: subcategory → workflow → published version, the START block, the first people step.
 * One tenant transaction does it all (ticket, values, visit, clocks, assignees, events, outbox); everything
 * that can fail is checked before the first write.
 */
@Injectable()
export class CreateTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(SubmissionValidator) private readonly submissions: SubmissionValidator,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
    @Inject(CreationGate) private readonly gate: CreationGate,
  ) {}

  create(actor: TicketCreator, request: CreateTicketRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const requesterId = request.requesterId ?? actor.userId;
      const requester = await this.people.findActiveMember(tx, tenantId, requesterId);
      if (requester === null) throw new InvalidReferenceError('The requester is not an active member');
      const company = await this.gate.companyOf(tx, tenantId, requester, request.companyId);
      const subcategory = await this.people.findAvailableSubcategory(tx, tenantId, request.subcategoryId, company.id, requester.departmentId);
      if (subcategory === null) throw new NotFoundError();
      const published = await this.versions.findForSubcategory(tx, tenantId, request.subcategoryId);
      if (published === null) throw new WorkflowNotAvailableError();
      assertRunnable(published.document);
      const priorityId = request.priorityId ?? subcategory.defaultPriorityId;
      this.assertMayCreateFor(actor, requesterId, { companyId: company.id, departmentId: requester.departmentId, siteId: requester.siteId, subcategoryId: request.subcategoryId, workflowId: published.workflowId, priorityId, creatorId: requester.userId });
      const start = this.startStep(published, request.startStepId);
      if ((await this.gate.allowedStarts(tx, tenantId, [start], requester, company)).length === 0) throw new InitiatorNotAllowedError();

      const submission = await this.submissions.validate(tx, {
        tenantId,
        document: published.document,
        stage: 'CREATION',
        step: start,
        input: request.values,
        existing: {},
        company,
        positionId: requester.positionId,
        at,
        uploaderId: actor.userId,
        attachmentIds: request.attachments,
      });
      const diversion = diversionEdge(published.document, submission.amounts, start.id);
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: null,
        document: published.document,
        entryStepId: diversion?.toStepId ?? start.id,
        values: submission.merged,
        companyId: company.id,
        siteId: requester.siteId,
        creatorId: requester.userId,
        calendar,
        timeZone: company.timeZone,
        at,
        chosenAssigneeId: request.assigneeId,
      });

      const currentStepId = arrival.kind === 'END' ? arrival.endStepId : arrival.step.id;
      const registeredById = requesterId === actor.userId ? null : actor.userId;
      const number = await this.writes.nextNumber(tx);
      const ticketId = await this.writes.insertTicket(tx, tenantId, number, {
        workflowId: published.workflowId,
        workflowVersionId: published.versionId,
        subcategoryId: request.subcategoryId,
        priorityId,
        companyId: company.id,
        departmentId: requester.departmentId,
        siteId: requester.siteId,
        creatorId: requester.userId,
        registeredById,
        title: request.title,
        descriptionHtml: sanitizeRichText(request.description),
        currentStepId,
        currentLoop: arrival.kind === 'END' ? 1 : arrival.plan.visit.loop,
        createdAt: at,
      });

      const loop = arrival.kind === 'END' ? 1 : arrival.plan.visit.loop;
      const events: EventPlan[] = [
        {
          type: 'CREATED',
          stepId: start.id,
          loop: 1,
          actorId: actor.userId,
          data: { requesterId, registeredById, startStepId: start.id },
          attachments: attachmentsPlanOf(submission.files, start.id, 'ATTACHMENT'),
          outbox: [{ type: 'ticket.created', payload: { number: number.toString(), versionId: published.versionId, companyId: company.id, creatorId: requester.userId, registeredById } }],
        },
        ...formulaFailureEvents(submission, start.id, 1),
        ...submission.amounts.warnings.map((warning): EventPlan => ({ type: 'AMOUNT_WARNING', stepId: start.id, loop: 1, actorId: actor.userId, data: { ...warning } })),
        ...(diversion === undefined
          ? []
          : [{ type: 'TRANSITIONED', stepId: start.id, transitionId: diversion.transitionId, loop: 1, actorId: null, data: { automatic: true, blockType: 'START', amountRuleId: diversion.ruleId } } satisfies EventPlan]),
        ...arrivalEvents(arrival, actor.userId, loop),
        ...(arrival.kind === 'END' ? [{ type: 'CLOSED', stepId: arrival.endStepId, loop: 1, actorId: actor.userId, data: { reason: 'WORKFLOW_ENDED' }, outbox: [{ type: 'ticket.closed', payload: { closedById: actor.userId } }] } satisfies EventPlan] : []),
      ];
      const openVisitId = await this.applier.apply(tx, tenantId, { id: ticketId, workflowVersionId: published.versionId, companyId: company.id }, this.mutation(at, actor.userId, [...submission.fieldWrites, ...arrival.computed.fieldWrites], arrival, events));
      return { id: ticketId, number: number.toString(), status: arrival.kind === 'END' ? 'CLOSED' : 'OPEN', currentStepId, openVisitId };
    });
  }

  private mutation(at: Date, actorId: string, fieldWrites: TicketMutation['fieldWrites'], arrival: Arrival, events: readonly EventPlan[]): TicketMutation {
    return arrival.kind === 'END'
      ? { at, actorId, fieldWrites, ticket: { kind: 'closed', stepId: arrival.endStepId }, events }
      : { at, actorId, fieldWrites, arrival: arrival.plan, ticket: { kind: 'current', stepId: arrival.step.id, loop: arrival.plan.visit.loop }, events };
  }

  private assertMayCreateFor(actor: TicketCreator, requesterId: string, record: NewTicketRecord): void {
    if (!actor.mayCreate(requesterId === actor.userId ? 'create' : 'create_for_others', record)) throw new PermissionDeniedError('Not allowed to create tickets for this person');
  }

  private startStep(published: PublishedWorkflow, startStepId: string | undefined): StepDocument {
    const starts = published.document.steps.filter((step) => step.type === 'START');
    const chosen = startStepId === undefined ? (starts.length === 1 ? starts[0] : undefined) : starts.find((step) => step.id === startStepId);
    if (chosen === undefined) throw new InvalidReferenceError('Choose a valid START block of the workflow');
    return chosen;
  }
}
