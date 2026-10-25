import { Inject, Injectable } from '@nestjs/common';
import { InvalidAssigneeError, InvalidStateError, type ReassignTicketRequest, type TicketMutationResponse } from '@procesabpm/shared';
import { sanitizeOptionalRichText } from '../../../infrastructure/text/rich-text.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { openSla } from '../../sla/domain/clock-math.js';
import { type MemberRow, TicketContextRepository } from '../data/ticket-context.repository.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { VisitPlan } from '../domain/plan.js';
import { isEligibleAssignee, isSigner, isSoleHolder, reassignRefusal } from '../domain/ticket-action-rules.js';
import { LockedTicketLoader, type TicketActor, type TicketInProgress } from './locked-ticket.js';
import { TicketSlaService } from './ticket-sla.service.js';

/**
 * Hands the current step to another person without leaving it: the previous responsible's clock closes with
 * its result and a new one starts for the new responsible, so the SLA restarts. The visit is untouched.
 */
@Injectable()
export class ReassignTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
  ) {}

  reassign(actor: TicketActor, ticketId: string, request: ReassignTicketRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, actor);
      const { ticket, visit } = current;
      const refusal = reassignRefusal(await actor.can(tx, ticketId, 'reassign'));
      if (refusal !== null) throw refusal;

      const target = await this.people.findActiveMember(tx, tenantId, request.toUserId);
      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const parallel = document.steps.find((candidate) => candidate.id === visit.stepId)?.assignmentMode === 'PARALLEL';
      if (request.addSigner === true) {
        if (!parallel) throw new InvalidStateError('Only a parallel step takes another signer');
        return this.addSignature(tx, tenantId, current, actor, request, target, at);
      }
      if (parallel) return this.reassignSignature(tx, tenantId, current, actor, request, target, at);
      if (target === null || !isEligibleAssignee(target, ticket.companyId) || isSoleHolder(current.assignees, target.userId)) throw new InvalidAssigneeError();

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, at);
      const opened = openSla({ value: visit.slaValue, unit: visit.slaUnit }, calendar?.calendar ?? null, at);
      const closedClocks = await this.sla.closeClocks(tx, tenantId, ticket.id, company, visit, current.clocks, at, 'REASSIGNED');

      const visitPlan: VisitPlan = { stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt, sla: { value: visit.slaValue, unit: visit.slaUnit }, calendarId: visit.calendarId, dueAt: visit.dueAt };
      await this.writes.closeClocks(tx, tenantId, at, closedClocks);
      await this.writes.deleteAssignees(tx, tenantId, ticket.id);
      await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: target.userId, type: 'PRIMARY' }]);
      await this.writes.insertClocks(tx, tenantId, ticket, visit.id, visitPlan, [{ responsibleId: target.userId, startedAt: at, sla: { value: opened.value, unit: opened.unit }, calendarId: visit.calendarId, dueAt: opened.dueAt }]);
      await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
        type: 'REASSIGNED',
        stepId: visit.stepId,
        loop: visit.loop,
        actorId: actor.userId,
        assigneeId: target.userId,
        commentHtml: sanitizeOptionalRichText(request.comment),
        data: { fromUserIds: current.assignees.map((assignee) => assignee.userId) },
        outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: target.userId, assigneeType: 'PRIMARY' } }],
      });
      return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
    });
  }

  /**
   * As in the help desk (`crearNuevoParalelo`): one more person signs the parallel step. They get a pending signature,
   * a PARALLEL assignment and their own clock; the other signatures stay as they are, and the step now also waits for
   * this one. The target must not already be a signer of this visit.
   */
  private async addSignature(tx: TenantTransaction, tenantId: string, current: TicketInProgress, actor: TicketActor, request: ReassignTicketRequest, target: MemberRow | null, at: Date): Promise<TicketMutationResponse> {
    const { ticket, visit } = current;
    const tasks = await this.writes.findParallelTasks(tx, tenantId, ticket.id, visit.stepId, visit.loop);
    if (target === null || !isEligibleAssignee(target, ticket.companyId) || isSigner(tasks, target.userId)) throw new InvalidAssigneeError();

    const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
    const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, at);
    const opened = openSla({ value: visit.slaValue, unit: visit.slaUnit }, calendar?.calendar ?? null, at);
    const visitPlan: VisitPlan = { stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt, sla: { value: visit.slaValue, unit: visit.slaUnit }, calendarId: visit.calendarId, dueAt: visit.dueAt };
    await this.writes.insertParallelTasks(tx, tenantId, ticket.id, visit.stepId, visit.loop, [target.userId]);
    await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: target.userId, type: 'PARALLEL' }]);
    await this.writes.insertClocks(tx, tenantId, ticket, visit.id, visitPlan, [{ responsibleId: target.userId, startedAt: at, sla: { value: opened.value, unit: opened.unit }, calendarId: visit.calendarId, dueAt: opened.dueAt }]);
    await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
      type: 'REASSIGNED',
      stepId: visit.stepId,
      loop: visit.loop,
      actorId: actor.userId,
      assigneeId: target.userId,
      commentHtml: sanitizeOptionalRichText(request.comment),
      data: { fromUserIds: [], addedSigner: true },
      outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: target.userId, assigneeType: 'PARALLEL' } }],
    });
    return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
  }

  /**
   * On a parallel step one person's pending signature moves to someone else: their clock closes, the task and the
   * PARALLEL assignment pass to the target, who gets a fresh clock. The target must not already be a signer.
   */
  private async reassignSignature(tx: TenantTransaction, tenantId: string, current: TicketInProgress, actor: TicketActor, request: ReassignTicketRequest, target: MemberRow | null, at: Date): Promise<TicketMutationResponse> {
    const { ticket, visit } = current;
    const tasks = await this.writes.findParallelTasks(tx, tenantId, ticket.id, visit.stepId, visit.loop);
    const source = tasks.find((task) => task.userId === request.fromUserId && task.status === 'PENDING');
    if (source === undefined || target === null || !isEligibleAssignee(target, ticket.companyId) || isSigner(tasks, target.userId)) throw new InvalidAssigneeError();

    const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
    const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, at);
    const opened = openSla({ value: visit.slaValue, unit: visit.slaUnit }, calendar?.calendar ?? null, at);
    const visitPlan: VisitPlan = { stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt, sla: { value: visit.slaValue, unit: visit.slaUnit }, calendarId: visit.calendarId, dueAt: visit.dueAt };
    const own = current.clocks.filter((clock) => clock.responsibleId === source.userId);
    await this.writes.closeClocks(tx, tenantId, at, await this.sla.closeClocks(tx, tenantId, ticket.id, company, visit, own, at, 'REASSIGNED'));
    await this.writes.moveParallelTask(tx, tenantId, source.id, target.userId);
    await this.writes.deleteAssignees(tx, tenantId, ticket.id, source.userId);
    await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: target.userId, type: 'PARALLEL' }]);
    await this.writes.insertClocks(tx, tenantId, ticket, visit.id, visitPlan, [{ responsibleId: target.userId, startedAt: at, sla: { value: opened.value, unit: opened.unit }, calendarId: visit.calendarId, dueAt: opened.dueAt }]);
    await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
      type: 'REASSIGNED',
      stepId: visit.stepId,
      loop: visit.loop,
      actorId: actor.userId,
      assigneeId: target.userId,
      commentHtml: sanitizeOptionalRichText(request.comment),
      data: { fromUserIds: [source.userId], parallelTaskId: source.id },
      outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: target.userId, assigneeType: 'PARALLEL' } }],
    });
    return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
  }
}
