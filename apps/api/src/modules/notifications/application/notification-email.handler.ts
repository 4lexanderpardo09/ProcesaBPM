import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import { singleLine } from '../../../infrastructure/mail/html.js';
import { renderEmail } from '../../../infrastructure/mail/layout.js';
import { type ClaimedEvent, type ExternalEffectHandler } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { NOTIFICATION_EMAIL_EVENT } from '../data/email-outbox.repository.js';
import { channelsFor } from '../domain/channels.js';
import { RecipientRepository } from '../data/recipient.repository.js';
import { TicketFactsRepository } from '../data/ticket-facts.repository.js';
import { notificationsEs as es } from '../i18n/es.js';
import { type NotificationEmailPayload, notificationEmailPayloadSchema } from './notification-email.payload.js';
import { TicketReaderFilter } from './ticket-reader-filter.js';

/**
 * Sends the e-mail of a notification. Before sending it checks again that the person is still an active member who
 * may read the ticket (permissions can change between the fan-out and the delivery). The subject is the fixed title
 * with the ticket number: names, titles and comments stay in the (escaped) body, or out of the e-mail altogether.
 */
@Injectable()
export class NotificationEmailHandler implements ExternalEffectHandler<NotificationEmailPayload, MailMessage>, OnModuleInit {
  readonly type = NOTIFICATION_EMAIL_EVENT;
  readonly scope = 'tenant' as const;
  readonly schema = notificationEmailPayloadSchema;

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(TicketFactsRepository) private readonly facts: TicketFactsRepository,
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(TicketReaderFilter) private readonly readers: TicketReaderFilter,
  ) {}

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: TenantTransaction, event: ClaimedEvent<NotificationEmailPayload>): Promise<MailMessage | null> {
    const tenantId = event.tenantId!;
    const { userId, ticketId, notificationType } = event.payload;
    const tenant = await this.facts.tenant(tx, tenantId);
    const ticket = await this.facts.ticket(tx, tenantId, ticketId);
    if (tenant === undefined || !tenant.active || ticket === undefined) return null;
    // Someone who turned e-mail off after the fan-out must not get what was already queued.
    const preferences = await this.recipients.preferences(tx, tenantId, [userId], [notificationType]);
    if (!channelsFor(preferences, userId, notificationType).email) return null;
    if ((await this.readers.filter(tx, tenantId, ticketId, [userId])).length === 0) return null;
    const recipient = await this.recipients.mailRecipient(tx, userId);
    if (recipient === undefined) return null;

    const subject = singleLine(es.titles[notificationType](ticket.number));
    const content = renderEmail({
      title: subject,
      greeting: es.email.greeting(recipient.firstName),
      paragraphs: [es.email.ticketLine(ticket.title)],
      action: { label: es.email.action, url: this.links.ticket(tenantId, ticketId) },
      footer: es.email.why(tenant.name),
    });
    return { to: recipient.email, subject, ...content, messageId: `<${event.id}@${this.settings.MAIL_MESSAGE_ID_DOMAIN}>` };
  }

  async perform(message: MailMessage): Promise<void> {
    await this.mailer.send(message);
  }
}
