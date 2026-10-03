import { Module } from '@nestjs/common';
import { MailModule } from '../../infrastructure/mail/mail.module.js';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { InvitationEmailHandler, PasswordResetEmailHandler, PlatformAdminInvitationEmailHandler, SecurityNoticeEmailHandler, TenantDeletionEmailHandler } from './application/account-email.handlers.js';
import { SecurityNoticeRecipientRepository } from './data/security-notice-recipient.repository.js';
import { WorkerTokenRepository } from './data/worker-token.repository.js';

/** The worker's side of the account e-mails: issues the one-time tokens, mails the links and the security notices. Imported by the worker only. */
@Module({ imports: [MailModule, OutboxDispatcherModule], providers: [WorkerTokenRepository, SecurityNoticeRecipientRepository, PasswordResetEmailHandler, InvitationEmailHandler, PlatformAdminInvitationEmailHandler, TenantDeletionEmailHandler, SecurityNoticeEmailHandler] })
export class AuthMailModule {}
