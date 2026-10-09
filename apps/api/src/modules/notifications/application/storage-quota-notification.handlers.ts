import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import { renderEmail } from '../../../infrastructure/mail/layout.js';
import type { ClaimedEvent, ExternalEffectHandler } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { PostCommitEffects } from '../../../infrastructure/outbox/post-commit-effects.js';
import { RealtimeSignalPublisher } from '../../../infrastructure/realtime/realtime-signal-publisher.js';
import { NotificationRepository } from '../data/notification.repository.js';
import { RecipientRepository } from '../data/recipient.repository.js';
import { TicketFactsRepository } from '../data/ticket-facts.repository.js';
import { channelsFor } from '../domain/channels.js';
import { formatStorageSize } from '../domain/storage-size.js';
import { notificationsEs as es } from '../i18n/es.js';
import { STORAGE_QUOTA_EMAIL_EVENT, type StorageQuotaEmail, storageQuotaEmailSchema, type StorageQuotaEvent, storageQuotaEventSchema } from './storage-quota.payload.js';

const STORAGE_QUOTA = 'STORAGE_QUOTA' as const;

const bodyOf = (payload: { level: number; usedBytes: string; limitBytes: string }): string =>
  es.storageQuota.body(payload.level, formatStorageSize(BigInt(payload.usedBytes)), formatStorageSize(BigInt(payload.limitBytes)));

/**
 * Tells the owner and the administrators that the stored files crossed 80 % or 95 % of the plan's limit (`storage.quota`,
 * queued by the files module once per crossing). The in-app notice is written in the transaction that completes the
 * event, like the ticket notifications; each e-mail is its own outbox event. Each person's preferences for STORAGE_QUOTA apply.
 */
@Injectable()
export class StorageQuotaNotificationHandlers implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(TicketFactsRepository) private readonly facts: TicketFactsRepository,
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(RealtimeSignalPublisher) private readonly realtime: RealtimeSignalPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.registerTransactional({ type: 'storage.quota', schema: storageQuotaEventSchema, handle: (tx, event, effects) => this.handle(tx, event as ClaimedEvent<StorageQuotaEvent>, effects) });
  }

  private async handle(tx: TenantTransaction, event: ClaimedEvent<StorageQuotaEvent>, effects: PostCommitEffects): Promise<void> {
    const tenantId = event.tenantId!;
    const tenant = await this.facts.tenant(tx, tenantId);
    if (tenant === undefined) return;
    const administratorIds = await this.recipients.administratorIds(tx, tenantId);
    const stored = await this.recipients.preferences(tx, tenantId, administratorIds, [STORAGE_QUOTA]);

    const inApp = administratorIds.filter((userId) => channelsFor(stored, userId, STORAGE_QUOTA).inApp);
    if (inApp.length > 0) {
      const title = es.titles.STORAGE_QUOTA();
      await this.notifications.createMany(tx, tenantId, inApp.map((userId) => ({ userId, ticketId: null, type: STORAGE_QUOTA, title, body: bodyOf(event.payload), sourceEventId: event.id })));
      effects.afterCommit(() => this.realtime.publish([{ v: 1, k: 'notifications', t: tenantId, u: inApp }]));
    }
    if (!tenant.active) return;
    const { level, usedBytes, limitBytes } = event.payload;
    const mails = administratorIds.filter((userId) => channelsFor(stored, userId, STORAGE_QUOTA).email).map((userId): StorageQuotaEmail => ({ userId, level, usedBytes, limitBytes, sourceEventId: event.id }));
    if (mails.length > 0) await tx.outboxEvent.createMany({ data: mails.map((payload) => ({ tenantId, type: STORAGE_QUOTA_EMAIL_EVENT, payload })) });
  }
}

/** Sends one storage warning e-mail, after checking again that the person still administers the organization and wants it. */
@Injectable()
export class StorageQuotaEmailHandler implements ExternalEffectHandler<StorageQuotaEmail, MailMessage>, OnModuleInit {
  readonly type = STORAGE_QUOTA_EMAIL_EVENT;
  readonly scope = 'tenant' as const;
  readonly schema = storageQuotaEmailSchema;

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(TicketFactsRepository) private readonly facts: TicketFactsRepository,
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
  ) {}

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: TenantTransaction, event: ClaimedEvent<StorageQuotaEmail>): Promise<MailMessage | null> {
    const tenantId = event.tenantId!;
    const { userId } = event.payload;
    const tenant = await this.facts.tenant(tx, tenantId);
    if (tenant === undefined || !tenant.active) return null;
    if (!(await this.recipients.administratorIds(tx, tenantId)).includes(userId)) return null;
    const preferences = await this.recipients.preferences(tx, tenantId, [userId], [STORAGE_QUOTA]);
    if (!channelsFor(preferences, userId, STORAGE_QUOTA).email) return null;
    const recipient = await this.recipients.mailRecipient(tx, userId);
    if (recipient === undefined) return null;

    const subject = es.titles.STORAGE_QUOTA();
    const content = renderEmail({
      title: subject,
      greeting: es.email.greeting(recipient.firstName),
      paragraphs: [bodyOf(event.payload), es.storageQuota.advice],
      action: { label: es.storageQuota.action, url: this.links.storageUsage(tenantId) },
      footer: es.storageQuota.why(tenant.name),
    });
    return { to: recipient.email, subject, ...content, messageId: `<${event.id}@${this.settings.MAIL_MESSAGE_ID_DOMAIN}>` };
  }

  async perform(message: MailMessage): Promise<void> {
    await this.mailer.send(message);
  }
}
