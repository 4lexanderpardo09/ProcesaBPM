import { Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError, StaleTicketError, type TakeTicketRequest, type TicketMutationResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';

/**
 * A member of a pool takes the ticket: they become its only PRIMARY assignee. The pool clock keeps running
 * (the time the ticket waited in the pool is not forgiven); it just gets its responsible.
 */
@Injectable()
export class TakeTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
  ) {}

  take(actor: TicketActor, ticketId: string, request: TakeTicketRequest): Promise<TicketMutationResponse> {
    // Whoever lost the race is no longer in the pool: they must hear "someone took it" (409), not "not found".
    const claimant: TicketActor = { ...actor, canRead: () => Promise.resolve(true) };
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, claimant);
      if (!current.actorIsPoolMember) {
        throw current.assignees.some((assignee) => assignee.type === 'PRIMARY') ? new StaleTicketError() : new PermissionDeniedError('The ticket is not in a pool you belong to');
      }
      const { ticket, visit } = current;
      await this.writes.deleteAssignees(tx, tenantId, ticket.id);
      await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: actor.userId, type: 'PRIMARY' }]);
      for (const clock of current.clocks.filter((candidate) => candidate.responsibleId === null)) await this.writes.assignClockResponsible(tx, tenantId, clock.id, actor.userId);
      await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
        type: 'ASSIGNED',
        stepId: visit.stepId,
        loop: visit.loop,
        actorId: actor.userId,
        assigneeId: actor.userId,
        data: { assigneeType: 'PRIMARY', tookFromPool: true },
        outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: actor.userId, assigneeType: 'PRIMARY' } }],
      });
      return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
    });
  }
}
