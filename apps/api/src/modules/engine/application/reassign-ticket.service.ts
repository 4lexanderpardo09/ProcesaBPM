import { Inject, Injectable } from '@nestjs/common';
import { InvalidAssigneeError, PermissionDeniedError, plainTextToHtml, type ReassignTicketRequest, type TicketMutationResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { openSla } from '../../sla/domain/clock-math.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { VisitPlan } from '../domain/plan.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
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
      if (!(await actor.can(tx, ticketId, 'reassign'))) throw new PermissionDeniedError('Not allowed to reassign tickets');

      const target = await this.people.findActiveMember(tx, tenantId, request.toUserId);
      const alreadyTheOnlyOne = current.assignees.length === 1 && current.assignees[0]!.userId === request.toUserId && current.assignees[0]!.type === 'PRIMARY';
      if (target === null || !target.companyIds.includes(ticket.companyId) || alreadyTheOnlyOne) throw new InvalidAssigneeError();

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const calendar = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, at);
      const opened = openSla({ value: visit.slaValue, unit: visit.slaUnit }, calendar?.calendar ?? null, at);
      const closedClocks = await this.sla.closeClocks(tx, tenantId, company, visit, current.clocks, at);

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
        commentHtml: request.comment === undefined ? null : plainTextToHtml(request.comment),
        data: { fromUserIds: current.assignees.map((assignee) => assignee.userId) },
        outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: target.userId, assigneeType: 'PRIMARY' } }],
      });
      return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
    });
  }
}
