import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import type { PostCommitEffects } from '../../../infrastructure/outbox/post-commit-effects.js';
import { RealtimeSignalPublisher } from '../../../infrastructure/realtime/realtime-signal-publisher.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { TicketTextRenderer } from '../../documents/application/ticket-text-renderer.js';
import { EmailOutboxRepository } from '../data/email-outbox.repository.js';
import { NotificationRepository } from '../data/notification.repository.js';
import { RecipientRepository } from '../data/recipient.repository.js';
import { TicketFactsRepository } from '../data/ticket-facts.repository.js';
import { channelsFor } from '../domain/channels.js';
import { namedIds, resolveBlockRecipients } from '../domain/block-recipients.js';
import type { NotificationEmailPayload } from './notification-email.payload.js';
import { TicketReaderFilter } from './ticket-reader-filter.js';

const blockEvent = z.object({ ticketId: uuidSchema, eventId: uuidSchema.optional(), stepId: uuidSchema }).passthrough();
type BlockEventPayload = z.infer<typeof blockEvent>;

const TITLE_MAX = 200;
const BODY_MAX = 10_000;
const BLOCK_NOTICE = 'SYSTEM' as const;

/**
 * Runs the NOTIFICATION blocks a ticket passes through: tells the people the block names, with the text the workflow's
 * designers wrote (placeholders filled with the ticket's data). Like the other notifications it only does database work, so
 * it runs in the transaction that completes the event and a repeated claim cannot notify twice. Only people who may read
 * the ticket are told (the text can carry its data), and each person's preferences for this kind of notice apply.
 */
@Injectable()
export class BlockNotificationHandlers implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(TicketFactsRepository) private readonly facts: TicketFactsRepository,
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(EmailOutboxRepository) private readonly emails: EmailOutboxRepository,
    @Inject(TicketReaderFilter) private readonly readers: TicketReaderFilter,
    @Inject(TicketTextRenderer) private readonly texts: TicketTextRenderer,
    @Inject(RealtimeSignalPublisher) private readonly realtime: RealtimeSignalPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.registerTransactional({ type: 'block.notification', schema: blockEvent, handle: (tx, event, effects) => this.handle(tx, event as ClaimedEvent<BlockEventPayload>, effects) });
  }

  private async handle(tx: TenantTransaction, event: ClaimedEvent<BlockEventPayload>, effects: PostCommitEffects): Promise<void> {
    const tenantId = event.tenantId!;
    const { ticketId, stepId } = event.payload;
    const block = await this.facts.notificationBlock(tx, tenantId, ticketId, stepId);
    const ticket = await this.facts.ticket(tx, tenantId, ticketId);
    const tenant = await this.facts.tenant(tx, tenantId);
    if (block === undefined || ticket === undefined || tenant === undefined) return;

    const named = await this.resolve(tx, tenantId, ticketId, ticket, block.recipients);
    const readerIds = await this.readers.filter(tx, tenantId, ticketId, named);
    if (readerIds.length === 0) return;
    const stored = await this.recipients.preferences(tx, tenantId, readerIds, [BLOCK_NOTICE]);
    const wantsInApp = block.channels.includes('IN_APP');
    const wantsEmail = block.channels.includes('EMAIL') && tenant.active;

    const inApp = readerIds.filter((userId) => wantsInApp && channelsFor(stored, userId, BLOCK_NOTICE).inApp);
    if (inApp.length > 0) {
      const rendered = await this.texts.render(tx, tenantId, ticketId, [block.subject, block.body], { stepId });
      // The ticket was deleted (tenant purge) after the event was queued: nothing to notify, by e-mail either.
      if (rendered === null) return;
      const [title, body] = rendered as [string, string];
      await this.notifications.createMany(tx, tenantId, inApp.map((userId) => ({ userId, ticketId, type: BLOCK_NOTICE, title: title.slice(0, TITLE_MAX), body: body.slice(0, BODY_MAX), sourceEventId: event.id })));
      // After the commit, tell the open screens of these people (ids only; they read their own counter).
      effects.afterCommit(() => this.realtime.publish([{ v: 1, k: 'notifications', t: tenantId, u: inApp }]));
    }
    const mails = readerIds.filter((userId) => wantsEmail && channelsFor(stored, userId, BLOCK_NOTICE).email).map((userId): NotificationEmailPayload => ({ userId, notificationType: BLOCK_NOTICE, ticketId, sourceEventId: event.id, stepId }));
    await this.emails.enqueue(tx, tenantId, mails);
  }

  private async resolve(tx: TenantTransaction, tenantId: string, ticketId: string, ticket: { creatorId: string; workflowId: string }, recipients: Parameters<typeof namedIds>[0]): Promise<string[]> {
    const assignees = recipients.some((recipient) => recipient.kind === 'ASSIGNEES') ? await this.facts.assignees(tx, tenantId, ticketId) : [];
    const observerIds = recipients.some((recipient) => recipient.kind === 'OBSERVERS') ? await this.facts.observerIds(tx, tenantId, ticket.workflowId) : [];
    return resolveBlockRecipients(recipients, {
      creatorId: ticket.creatorId,
      assigneeIds: assignees.map((assignee) => assignee.userId),
      observerIds,
      positionMembers: await this.facts.positionMembers(tx, tenantId, namedIds(recipients, 'POSITION')),
      groupMembers: await this.facts.groupMembers(tx, tenantId, namedIds(recipients, 'GROUP')),
    });
  }
}
