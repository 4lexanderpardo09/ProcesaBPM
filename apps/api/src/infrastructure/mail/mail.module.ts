import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { InMemoryMailer } from './in-memory-mailer.js';
import { WebLinks } from './links.js';
import { Mailer } from './mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/** E-mail for the worker: SMTP, or an in-memory mailbox in tests (never in production, the settings refuse it). */
@Module({
  providers: [
    WebLinks,
    {
      provide: Mailer,
      inject: [WORKER_SETTINGS],
      useFactory: (settings: WorkerSettings): Mailer =>
        settings.MAIL_TRANSPORT === 'memory'
          ? new InMemoryMailer()
          : new SmtpMailer({ host: settings.SMTP_HOST!, port: settings.SMTP_PORT, secure: settings.SMTP_SECURE, user: settings.SMTP_USER, password: settings.SMTP_PASSWORD, from: settings.MAIL_FROM }),
    },
  ],
  exports: [Mailer, WebLinks],
})
export class MailModule {}
