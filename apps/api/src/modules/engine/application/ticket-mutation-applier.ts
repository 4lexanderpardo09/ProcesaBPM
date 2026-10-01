import { Inject, Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { TicketMutation } from '../domain/plan.js';

export interface MutatedTicket {
  readonly id: string;
  readonly workflowVersionId: string;
  readonly companyId: string;
}

/**
 * Writes a `TicketMutation`. The order is what the database constraints need (docs/base-de-datos.md §8):
 * clocks and the visit close before the next visit opens (one open visit per ticket), the assignees are
 * replaced, the ticket row moves, and the events and outbox rows come last. Everything is in the caller's
 * transaction, whose first statement locked the ticket row.
 */
@Injectable()
export class TicketMutationApplier {
  constructor(
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(FileAttachmentService) private readonly files: FileAttachmentService,
  ) {}

  /** Returns the id of the visit the ticket is in afterwards, `null` when it is closed. */
  async apply(tx: TenantTransaction, tenantId: string, ticket: MutatedTicket, mutation: TicketMutation): Promise<string | null> {
    const { at } = mutation;
    await this.writes.upsertFieldValues(tx, tenantId, ticket.id, ticket.workflowVersionId, mutation.actorId, mutation.fieldWrites);
    if (mutation.closing !== undefined) {
      await this.writes.closeClocks(tx, tenantId, at, mutation.closing.clocks);
      await this.writes.closeVisit(tx, tenantId, at, mutation.closing.visit);
      await this.writes.deleteAssignees(tx, tenantId, ticket.id);
    }
    let openVisitId: string | null = null;
    if (mutation.arrival !== undefined) {
      const { visit, clocks, assignees } = mutation.arrival;
      openVisitId = await this.writes.insertVisit(tx, tenantId, ticket.id, visit);
      await this.writes.insertClocks(tx, tenantId, ticket, openVisitId, visit, clocks);
      if (assignees.length > 0) await this.writes.insertAssignees(tx, tenantId, ticket.id, at, assignees);
      if (mutation.arrival.parallelTasks.length > 0) await this.writes.insertParallelTasks(tx, tenantId, ticket.id, visit.stepId, visit.loop, mutation.arrival.parallelTasks);
    }
    if (mutation.ticket.kind === 'current') await this.writes.moveTicket(tx, tenantId, ticket.id, mutation.ticket.stepId, mutation.ticket.loop);
    else if (mutation.ticket.kind === 'reopened') await this.writes.reopenTicket(tx, tenantId, ticket.id, mutation.ticket.stepId, mutation.ticket.loop);
    else await this.writes.closeTicket(tx, tenantId, ticket.id, at, mutation.actorId, mutation.ticket.stepId);
    for (const event of mutation.events) {
      const eventId = await this.writes.insertEvent(tx, tenantId, ticket.id, at, event);
      if (event.attachments !== undefined) await this.files.link(tx, tenantId, { ...event.attachments, ticketId: ticket.id, companyId: ticket.companyId, eventId, at, attachmentRole: event.attachments.role });
    }
    return openVisitId;
  }
}
