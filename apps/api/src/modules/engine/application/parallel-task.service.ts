import { Inject, Injectable } from '@nestjs/common';
import {
  CommentRequiredError,
  InvalidStateError,
  ParallelTaskNotPendingError,
  type ParallelTaskActionRequest,
  PermissionDeniedError,
  RejectionNotAllowedError,
  type TicketMutationResponse,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeOptionalRichText } from '../../../infrastructure/text/rich-text.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { parallelExits, parallelOutcome } from '../domain/parallel-policy.js';
import type { EventPlan, TicketMutation } from '../domain/plan.js';
import { arrivalEvents, ArrivalPlanner } from './arrival-planner.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';
import { TicketSlaService } from './ticket-sla.service.js';

/**
 * Signs or rejects the caller's own signature of a PARALLEL step. Everybody must sign: the last signature
 * leaves the step through its DECISION; the first rejection cancels the pending signatures and leaves through
 * its SYSTEM_ONLY transition. Until then only the signer's own clock closes. Being the named signer is the
 * authorization, as the person is not a "holder" of the step: the route only needs read access.
 */
@Injectable()
export class ParallelTaskService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(ArrivalPlanner) private readonly planner: ArrivalPlanner,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  sign(actor: TicketActor, ticketId: string, request: ParallelTaskActionRequest): Promise<TicketMutationResponse> {
    return this.act(actor, ticketId, request, 'SIGN');
  }

  reject(actor: TicketActor, ticketId: string, request: ParallelTaskActionRequest): Promise<TicketMutationResponse> {
    return this.act(actor, ticketId, request, 'REJECT');
  }

  private act(actor: TicketActor, ticketId: string, request: ParallelTaskActionRequest, action: 'SIGN' | 'REJECT'): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, actor);
      const { ticket, visit } = current;

      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const step = document.steps.find((candidate) => candidate.id === visit.stepId);
      if (step === undefined || step.assignmentMode !== 'PARALLEL') throw new InvalidStateError('The current step is not a parallel step');
      const tasks = await this.writes.findParallelTasks(tx, tenantId, ticket.id, step.id, visit.loop);
      const mine = tasks.find((task) => task.userId === actor.userId);
      if (mine === undefined) throw new PermissionDeniedError('You are not a signer of this step');
      if (mine.status !== 'PENDING') throw new ParallelTaskNotPendingError();

      const exits = parallelExits(document, step.id);
      const outcome = parallelOutcome(tasks, actor.userId, action);
      if (action === 'REJECT') {
        if (exits.rejection === null) throw new RejectionNotAllowedError();
        if (step.type === 'APPROVAL' && step.config.rejectRequiresComment !== false && (request.comment ?? '').trim() === '') throw new CommentRequiredError();
      }
      const comment = sanitizeOptionalRichText(request.comment);
      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const taskEvent = (taskId: string, userId: string, status: 'SIGNED' | 'REJECTED' | 'CANCELLED'): EventPlan => ({
        type: 'PARALLEL_TASK_COMPLETED',
        stepId: step.id,
        loop: visit.loop,
        actorId: actor.userId,
        assigneeId: userId,
        commentHtml: userId === actor.userId ? comment : null,
        data: { taskId, status },
        outbox: [{ type: 'ticket.parallel_task_completed', payload: { taskId, status } }],
      });

      await this.writes.completeParallelTask(tx, tenantId, mine.id, action === 'SIGN' ? 'SIGNED' : 'REJECTED', at, comment);
      const events: EventPlan[] = [taskEvent(mine.id, actor.userId, action === 'SIGN' ? 'SIGNED' : 'REJECTED')];

      if (outcome.kind === 'WAIT') {
        const own = current.clocks.filter((clock) => clock.responsibleId === actor.userId);
        await this.writes.closeClocks(tx, tenantId, at, await this.sla.closeClocks(tx, tenantId, ticket.id, company, visit, own, at));
        for (const event of events) await this.writes.insertEvent(tx, tenantId, ticket.id, at, event);
        return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: step.id, openVisitId: visit.id };
      }

      const rejected = outcome.kind === 'REJECTED';
      const exit = rejected ? exits.rejection! : exits.approval;
      if (rejected) {
        for (const userId of outcome.cancelUserIds) {
          const task = tasks.find((candidate) => candidate.userId === userId)!;
          await this.writes.completeParallelTask(tx, tenantId, task.id, 'CANCELLED', at, null);
          events.push(taskEvent(task.id, userId, 'CANCELLED'));
        }
      }
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, company.calendarId, at);
      const arrival = await this.planner.plan(tx, {
        tenantId,
        ticketId: ticket.id,
        document,
        entryStepId: exit.toStepId,
        values: await this.loader.valuesOf(tx, tenantId, ticket.id, document),
        companyId: ticket.companyId,
        siteId: ticket.siteId,
        creatorId: ticket.creatorId,
        calendar,
        at,
        chosenAssigneeId: request.assigneeId,
      });
      const closing = await this.sla.closeVisit(tx, tenantId, ticket.id, company, visit, current.clocks, at, exit.id);
      events.push(
        {
          type: 'TRANSITIONED',
          stepId: step.id,
          transitionId: exit.id,
          loop: visit.loop,
          actorId: actor.userId,
          data: { parallelOutcome: rejected ? 'REJECTED' : 'APPROVED' },
          outbox: [{ type: 'ticket.transitioned', payload: { fromStepId: step.id, toStepId: exit.toStepId, transitionId: exit.id, actorId: actor.userId } }],
        },
        ...arrivalEvents(arrival, actor.userId, visit.loop),
        ...(arrival.kind === 'END' ? [{ type: 'CLOSED', stepId: arrival.endStepId, loop: visit.loop, actorId: actor.userId, data: { reason: 'WORKFLOW_ENDED' }, outbox: [{ type: 'ticket.closed', payload: { closedById: actor.userId } }] } satisfies EventPlan] : []),
      );
      const mutation: TicketMutation =
        arrival.kind === 'END'
          ? { at, actorId: actor.userId, fieldWrites: [], closing, ticket: { kind: 'closed', stepId: arrival.endStepId }, events }
          : { at, actorId: actor.userId, fieldWrites: [], closing, arrival: arrival.plan, ticket: { kind: 'current', stepId: arrival.step.id, loop: arrival.plan.visit.loop }, events };
      const openVisitId = await this.applier.apply(tx, tenantId, { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId }, mutation);
      return { id: ticket.id, number: ticket.number.toString(), status: arrival.kind === 'END' ? 'CLOSED' : 'OPEN', currentStepId: arrival.kind === 'END' ? arrival.endStepId : arrival.step.id, openVisitId };
    });
  }
}
