import { Module } from '@nestjs/common';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { RealtimeSignalPublisherModule } from '../../infrastructure/realtime/realtime-signal-publisher.module.js';
import { TicketChangeSignalHandlers } from './application/ticket-change-signals.handlers.js';

/** The worker's side of real time: signals for ticket changes. Imported by the worker only. */
@Module({ imports: [OutboxDispatcherModule, RealtimeSignalPublisherModule], providers: [TicketChangeSignalHandlers] })
export class RealtimeWorkerModule {}
