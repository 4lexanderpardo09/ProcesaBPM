import { Module } from '@nestjs/common';
import { JsonLogger } from '../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { InMemoryMailer } from './in-memory-mailer.js';
import { WebLinks } from './links.js';
import { Mailer } from './mailer.js';
import { ReservedDomainMailer } from './reserved-domain-mailer.js';
import { SmtpMailer } from './smtp-mailer.js';
import { DatabaseSuppressionList, SuppressionAwareMailer, SuppressionList } from './suppression-aware-mailer.js';

/** The transport alone (SMTP, or the in-memory mailbox of the tests), before the suppression check. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * E-mail for the worker: SMTP, or an in-memory mailbox in tests (never in production, the settings refuse it). Whatever
 * the transport, a suppressed address (a permanent bounce or a complaint) is not written to.
 */
@Module({
  providers: [
    WebLinks,
    { provide: SuppressionList, useClass: DatabaseSuppressionList },
    {
      provide: Mailer,
      inject: [MAIL_TRANSPORT, SuppressionList, JsonLogger],
      useFactory: (transport: Mailer, suppressions: SuppressionList, logger: JsonLogger): Mailer => new SuppressionAwareMailer(transport, suppressions, logger),
    },
    {
      provide: MAIL_TRANSPORT,
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
  exports: [Mailer, MAIL_TRANSPORT, WebLinks],
})
export class MailModule {}
