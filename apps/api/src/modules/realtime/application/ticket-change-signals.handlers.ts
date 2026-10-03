import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { TICKET_CHANGE_KINDS, type TicketChangeKind, uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { RealtimeSignalPublisher } from '../../../infrastructure/realtime/realtime-signal-publisher.js';

const payloadSchema = z.object({ ticketId: uuidSchema.optional() }).passthrough();

/**
 * Tells the open screens of a ticket that it changed. It adds no database work: it only schedules a signal after the
 * commit of events other modules already handle. Registering a transactional handler makes the dispatcher claim that
 * event type, so this one must only ride on types somebody else handles, or those events would complete with no effect.
 */
@Injectable()
export class TicketChangeSignalHandlers implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(RealtimeSignalPublisher) private readonly publisher: RealtimeSignalPublisher,
  ) {}

  onModuleInit(): void {
    for (const kind of TICKET_CHANGE_KINDS) {
      this.registry.registerTransactional({
        type: kind,
        schema: payloadSchema,
        handle: (_tx, event, effects) => {
          const { ticketId } = event.payload;
          if (ticketId !== undefined) effects.afterCommit(() => this.publisher.publish([{ v: 1, k: 'ticket', t: event.tenantId!, id: ticketId, e: kind }]));
          return Promise.resolve();
        },
      });
    }
  }

  /** Every module registers its handlers in `onModuleInit`, so by now each type must have one besides ours. */
  onApplicationBootstrap(): void {
    for (const kind of TICKET_CHANGE_KINDS) this.assertHasAnotherHandler(kind);
  }

  private assertHasAnotherHandler(kind: TicketChangeKind): void {
    if (this.registry.transactionalFor(kind).length < 2) throw new Error(`The realtime signal for ${kind} would be its only handler: the event would complete with no effect`);
  }
}
