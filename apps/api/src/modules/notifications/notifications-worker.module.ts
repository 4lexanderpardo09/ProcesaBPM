import { Module } from '@nestjs/common';
import { MailModule } from '../../infrastructure/mail/mail.module.js';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { RealtimeSignalPublisherModule } from '../../infrastructure/realtime/realtime-signal-publisher.module.js';
import { TicketAccessModule } from '../tickets/ticket-access.module.js';
import { DocumentsWorkerModule } from '../documents/documents-worker.module.js';
import { BlockNotificationHandlers } from './application/block-notification.handlers.js';
import { NotificationEmailHandler } from './application/notification-email.handler.js';
import { TicketNotificationHandlers } from './application/ticket-notification.handlers.js';
import { TicketReaderFilter } from './application/ticket-reader-filter.js';
import { EmailOutboxRepository } from './data/email-outbox.repository.js';
import { NotificationRepository } from './data/notification.repository.js';
import { RecipientRepository } from './data/recipient.repository.js';
import { TicketFactsRepository } from './data/ticket-facts.repository.js';

/** The worker's side of notifications: turns ticket events into in-app notices and e-mails. Imported by the worker only. */
@Module({
  imports: [OutboxDispatcherModule, MailModule, TicketAccessModule, RealtimeSignalPublisherModule, DocumentsWorkerModule],
  providers: [TicketFactsRepository, RecipientRepository, NotificationRepository, EmailOutboxRepository, TicketReaderFilter, TicketNotificationHandlers, BlockNotificationHandlers, NotificationEmailHandler],
})
export class NotificationsWorkerModule {}
