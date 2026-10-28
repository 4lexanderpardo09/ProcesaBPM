import { Module } from '@nestjs/common';
import { MailModule } from '../../infrastructure/mail/mail.module.js';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { DemoRequestEmailHandler } from './application/demo-request-email.handler.js';
import { DemoRequestMailRepository } from './data/demo-request-mail.repository.js';

/** The worker's side of the demo requests: the e-mail to the sales inbox. Imported by the worker only. */
@Module({ imports: [MailModule, OutboxDispatcherModule], providers: [DemoRequestMailRepository, DemoRequestEmailHandler] })
export class DemoRequestsWorkerModule {}
