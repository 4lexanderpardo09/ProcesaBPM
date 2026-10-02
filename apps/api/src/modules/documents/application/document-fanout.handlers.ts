import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { DocumentMoment } from '@procesabpm/db';
import { uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { DocumentFanoutRepository } from '../data/document-fanout.repository.js';
import { DocumentOutboxRepository } from '../data/document-outbox.repository.js';
import { DocumentSourceRepository } from '../data/document-source.repository.js';
import type { DocumentGeneratePayload } from './document-generate.payload.js';

const ticketEvent = z.object({ ticketId: uuidSchema, eventId: uuidSchema.optional() }).passthrough();
const blockEvent = z.object({ ticketId: uuidSchema, eventId: uuidSchema.optional(), stepId: uuidSchema }).passthrough();
type TicketEventPayload = z.infer<typeof ticketEvent>;

/**
 * Turns what happens to a ticket into `document.generate` events: the documents a workflow produces at creation, at each
 * step or at closing, and the ones its DOCUMENT blocks ask for. It only writes outbox rows, so it runs in the transaction
 * that completes the event: each ticket event queues its documents exactly once.
 */
@Injectable()
export class DocumentFanoutHandlers implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(DocumentFanoutRepository) private readonly tickets: DocumentFanoutRepository,
    @Inject(DocumentSourceRepository) private readonly sources: DocumentSourceRepository,
    @Inject(DocumentOutboxRepository) private readonly outbox: DocumentOutboxRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onModuleInit(): void {
    this.registry.registerTransactional({ type: 'ticket.created', schema: ticketEvent, handle: (tx, event) => this.atMoments(tx, event, ['CREATION']) });
    this.registry.registerTransactional({ type: 'ticket.transitioned', schema: ticketEvent, handle: (tx, event) => this.onTransitioned(tx, event) });
    // Closing counts as the last step too, so a workflow that only asks for a document "at each step" still gets the final one.
    this.registry.registerTransactional({ type: 'ticket.closed', schema: ticketEvent, handle: (tx, event) => this.atMoments(tx, event, ['CLOSING', 'EACH_STEP']) });
    this.registry.registerTransactional({ type: 'block.document', schema: blockEvent, handle: (tx, event) => this.onDocumentBlock(tx, event as ClaimedEvent<z.infer<typeof blockEvent>>) });
  }

  /** A movement that ends the ticket also emits `ticket.closed`, which asks for the documents of the end: asking twice would draw the same thing twice. */
  private async onTransitioned(tx: WorkerTransaction, event: ClaimedEvent<TicketEventPayload>): Promise<void> {
    const tenantId = event.tenantId!;
    const { ticketId, eventId } = event.payload;
    const at = eventId === undefined ? null : await this.tickets.eventTime(tx, tenantId, ticketId, eventId);
    // Looked up in the events themselves, not in the ticket's current state: a reopening in between must not bring the document back.
    if (at !== null && (await this.tickets.closedAt(tx, tenantId, ticketId, at))) return;
    await this.atMoments(tx, event, ['EACH_STEP']);
  }

  private async atMoments(tx: WorkerTransaction, event: ClaimedEvent<TicketEventPayload>, moments: readonly DocumentMoment[]): Promise<void> {
    const tenantId = event.tenantId!;
    const { ticketId, eventId } = event.payload;
    if (eventId === undefined) return;
    const ticket = await this.tickets.ticket(tx, tenantId, ticketId);
    if (ticket === null) return;
    const payloads: DocumentGeneratePayload[] = [];
    for (const moment of moments) {
      const ids = await this.sources.activeForMoment(tx, tenantId, ticket.workflowId, ticket.companyId, moment);
      payloads.push(...ids.map((workflowDocumentId): DocumentGeneratePayload => ({ ticketId, ticketEventId: eventId, workflowDocumentId, role: 'MAIN_DOCUMENT', stepId: null, trigger: moment })));
    }
    // A document asked for by two moments of the same event is still drawn once.
    const unique = [...new Map(payloads.map((payload) => [payload.workflowDocumentId, payload])).values()];
    await this.outbox.enqueue(tx, tenantId, unique);
  }

  private async onDocumentBlock(tx: WorkerTransaction, event: ClaimedEvent<z.infer<typeof blockEvent>>): Promise<void> {
    const tenantId = event.tenantId!;
    const { ticketId, eventId, stepId } = event.payload;
    if (eventId === undefined) return;
    const block = await this.tickets.documentBlock(tx, tenantId, ticketId, stepId);
    if (block === null) {
      this.logger.warn({ message: 'A DOCUMENT block asked for a document that cannot be resolved', tenantId, ticketId, stepId }, 'DocumentFanoutHandlers');
      return;
    }
    await this.outbox.enqueue(tx, tenantId, [{ ticketId, ticketEventId: eventId, workflowDocumentId: block.workflowDocumentId, role: block.role, stepId: block.role === 'STEP_DOCUMENT' ? stepId : null, trigger: 'BLOCK' }]);
  }
}
