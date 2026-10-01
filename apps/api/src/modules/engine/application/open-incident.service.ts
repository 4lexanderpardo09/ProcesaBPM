import { Inject, Injectable } from '@nestjs/common';
import { type IncidentMutationResponse, InvalidAssigneeError, type OpenIncidentRequest, PermissionDeniedError, ValidationFailedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';

const HOLDS_THE_STEP = new Set(['PRIMARY', 'POOL', 'PARALLEL']);

/**
 * Opens an incident (novedad): the running clocks stand still, the ticket is PAUSED and the step is handed to
 * the person the incident is for until they resolve it. The database requires PAUSED exactly while there is an
 * open incident (checked at COMMIT), so the ticket row and the incident are written in the same transaction.
 */
@Injectable()
export class OpenIncidentService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  open(actor: TicketActor, ticketId: string, request: OpenIncidentRequest): Promise<IncidentMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const locked = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      const current = await this.loader.requireOpenVisit(tx, tenantId, locked, request.visitId);
      const { ticket, visit } = current;

      const holder = current.ownType !== undefined && HOLDS_THE_STEP.has(current.ownType);
      if (!(await actor.can(tx, ticketId, 'open_incident')) || !(holder || (await actor.can(tx, ticketId, 'reassign')))) throw new PermissionDeniedError('Not allowed to open an incident on this ticket');
      const target = await this.people.findActiveMember(tx, tenantId, request.assignedToId);
      if (target === null || !target.companyIds.includes(ticket.companyId)) throw new InvalidAssigneeError();
      const description = sanitizeRichText(request.description);
      if (description === '') throw new ValidationFailedError([{ path: 'description', message: 'The description is empty' }]);

      const previous = current.assignees.map((assignee) => assignee.userId).sort();
      await this.writes.pauseClocks(tx, tenantId, visit.id, at);
      await this.writes.deleteAssignees(tx, tenantId, ticket.id);
      await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: target.userId, type: 'INCIDENT' }]);
      const incidentId = await this.writes.insertIncident(tx, tenantId, ticket.id, { stepId: visit.stepId, createdById: actor.userId, assignedToId: target.userId, description, previousAssigneeIds: previous, openedAt: at });
      await this.writes.setTicketStatus(tx, tenantId, ticket.id, 'PAUSED');
      await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
        type: 'INCIDENT_OPENED',
        stepId: visit.stepId,
        loop: visit.loop,
        actorId: actor.userId,
        assigneeId: target.userId,
        commentHtml: description,
        data: { incidentId, previousAssigneeIds: previous },
        outbox: [{ type: 'ticket.incident_opened', payload: { incidentId, assignedToId: target.userId } }],
      });
      return { id: ticket.id, number: ticket.number.toString(), status: 'PAUSED', currentStepId: visit.stepId, openVisitId: visit.id, incidentId };
    });
  }
}
