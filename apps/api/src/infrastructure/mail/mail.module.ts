import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { InMemoryMailer } from './in-memory-mailer.js';
import { WebLinks } from './links.js';
import { Mailer } from './mailer.js';
import { ReservedDomainMailer } from './reserved-domain-mailer.js';
import { SmtpMailer } from './smtp-mailer.js';

/** E-mail for the worker: SMTP, or an in-memory mailbox in tests (never in production, the settings refuse it). */
@Module({
  providers: [
    WebLinks,
    {
      provide: Mailer,
      inject: [WORKER_SETTINGS],
      useFactory: (settings: WorkerSettings): Mailer => {
        if (settings.MAIL_TRANSPORT === 'memory') return new InMemoryMailer();
        const real = new SmtpMailer({ host: settings.SMTP_HOST!, port: settings.SMTP_PORT, secure: settings.SMTP_SECURE, user: settings.SMTP_USER, password: settings.SMTP_PASSWORD, from: settings.MAIL_FROM });
        // Test addresses (…@procesa-e2e.test, …@smoke.invalid) never reach the real provider: the catcher, or nowhere.
        const catcherHost = settings.MAIL_CATCHER_HOST;
        const catcher = catcherHost === undefined ? undefined : catcherHost === settings.SMTP_HOST ? real : new SmtpMailer({ host: catcherHost, port: settings.MAIL_CATCHER_PORT, secure: false, from: settings.MAIL_FROM });
        return new ReservedDomainMailer(real, catcher);
      },
    },
  ],
  exports: [Mailer, WebLinks],
})
export class MailModule {}
