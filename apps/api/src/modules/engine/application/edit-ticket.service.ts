import { Inject, Injectable } from '@nestjs/common';
import { type EditTicketRequest, type EditTicketResponse, InvalidReferenceError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { type TicketHeader, TicketWriteRepository } from '../data/ticket-write.repository.js';
import { editRefusal } from '../domain/ticket-action-rules.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';

type HeaderChange = { readonly [K in keyof TicketHeader]: { readonly code: K; readonly before: TicketHeader[K]; readonly after: TicketHeader[K] } }[keyof TicketHeader];

/**
 * Corrects what a ticket says (its subject, description or priority) without moving it: a supervisor fixing a
 * badly titled request, or raising its priority. It needs the `update` permission on this very ticket and an
 * open or paused ticket; the previous values stay in the timeline (`FIELDS_UPDATED`, source `EDIT`).
 */
@Injectable()
export class EditTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  edit(actor: TicketActor, ticketId: string, request: EditTicketRequest): Promise<EditTicketResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const { ticket } = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      const refusal = editRefusal(await actor.can(tx, ticket.id, 'update'), ticket.status);
      if (refusal !== null) throw refusal;
      if (request.priorityId != null && !(await this.writes.isActivePriority(tx, tenantId, request.priorityId))) throw new InvalidReferenceError('Unknown or inactive priority');

      const before = await this.writes.findTicketHeader(tx, tenantId, ticket.id);
      const after: TicketHeader = {
        title: request.title ?? before.title,
        descriptionHtml: request.description === undefined ? before.descriptionHtml : sanitizeRichText(request.description),
        priorityId: request.priorityId === undefined ? before.priorityId : request.priorityId,
      };
      const changes = headerChanges(before, after);
      if (changes.length === 0) return { eventId: null };

      await this.writes.updateTicketHeader(tx, tenantId, ticket.id, Object.fromEntries(changes.map((change) => [change.code, change.after])));
      const eventId = await this.writes.insertEvent(tx, tenantId, ticket.id, this.clock.now(), {
        type: 'FIELDS_UPDATED',
        stepId: ticket.currentStepId,
        loop: ticket.currentLoop,
        actorId: actor.userId,
        data: { changes, source: 'EDIT' },
      });
      return { eventId };
    });
  }
}

function headerChanges(before: TicketHeader, after: TicketHeader): HeaderChange[] {
  const changes: HeaderChange[] = [];
  if (before.title !== after.title) changes.push({ code: 'title', before: before.title, after: after.title });
  if (before.descriptionHtml !== after.descriptionHtml) changes.push({ code: 'descriptionHtml', before: before.descriptionHtml, after: after.descriptionHtml });
  if (before.priorityId !== after.priorityId) changes.push({ code: 'priorityId', before: before.priorityId, after: after.priorityId });
  return changes;
}
