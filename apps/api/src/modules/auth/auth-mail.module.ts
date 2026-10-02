import { Module } from '@nestjs/common';
import { MailModule } from '../../infrastructure/mail/mail.module.js';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { InvitationEmailHandler, PasswordResetEmailHandler } from './application/account-email.handlers.js';
import { WorkerTokenRepository } from './data/worker-token.repository.js';

/** The worker's side of the account e-mails: issues the one-time tokens and mails the links. Imported by the worker only. */
@Module({ imports: [MailModule, OutboxDispatcherModule], providers: [WorkerTokenRepository, PasswordResetEmailHandler, InvitationEmailHandler] })
export class AuthMailModule {}
