import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type NotificationTypeValue, uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import type { PostCommitEffects } from '../../../infrastructure/outbox/post-commit-effects.js';
import { RealtimeSignalPublisher } from '../../../infrastructure/realtime/realtime-signal-publisher.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { EmailOutboxRepository } from '../data/email-outbox.repository.js';
import { NotificationRepository, type NewNotification } from '../data/notification.repository.js';
import { RecipientRepository } from '../data/recipient.repository.js';
import { TicketFactsRepository } from '../data/ticket-facts.repository.js';
import { channelsFor } from '../domain/channels.js';
import { notificationText } from '../domain/notification-text.js';
import { candidatesFor, chooseRecipients, type EventFacts, TICKET_EVENT_KINDS, type TicketEventKind } from '../domain/recipient-policy.js';
import type { NotificationEmailPayload } from './notification-email.payload.js';
import { TicketReaderFilter } from './ticket-reader-filter.js';

const base = z.object({ ticketId: uuidSchema, eventId: uuidSchema.optional() }).passthrough();
const SCHEMAS = {
  'ticket.created': base,
  'ticket.assigned': base.extend({ userId: uuidSchema }),
  'ticket.transitioned': base,
  'ticket.closed': base,
  'ticket.reopened': base,
  'ticket.commented': base,
  'ticket.incident_opened': base.extend({ incidentId: uuidSchema }),
  'ticket.incident_resolved': base.extend({ incidentId: uuidSchema }),
  'sla.overdue': z.object({ ticketId: uuidSchema, clockId: uuidSchema }).passthrough(),
  'sla.warning': z.object({ ticketId: uuidSchema, clockId: uuidSchema }).passthrough(),
} as const satisfies Record<TicketEventKind, z.ZodType>;

type Payload = { ticketId: string; eventId?: string | undefined; userId?: string; incidentId?: string; clockId?: string };

/** Observers hear about progress, not about every comment or about things aimed at one person. */
const NOTIFIES_OBSERVERS: ReadonlySet<TicketEventKind> = new Set(['ticket.created', 'ticket.transitioned', 'ticket.closed', 'ticket.reopened', 'sla.overdue']);

/** Events that move a ticket but are already covered by another one (`ticket.transitioned`, `ticket.assigned`). */
const COVERED_ELSEWHERE = ['ticket.parallel_task_completed'] as const;

/**
 * Turns ticket events into notifications. Everything here is database work, so it runs in the transaction that
 * completes the event: a repeated or abandoned claim cannot notify twice (and a unique key per event and person is
 * the second guard). In-app rows are written right away; each e-mail is queued as its own event, so its retries never
 * touch the in-app notification. Only people who may read the ticket are told.
 */
@Injectable()
export class TicketNotificationHandlers implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(TicketFactsRepository) private readonly facts: TicketFactsRepository,
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(EmailOutboxRepository) private readonly emails: EmailOutboxRepository,
    @Inject(TicketReaderFilter) private readonly readers: TicketReaderFilter,
    @Inject(RealtimeSignalPublisher) private readonly realtime: RealtimeSignalPublisher,
  ) {}

  onModuleInit(): void {
    for (const kind of TICKET_EVENT_KINDS) {
      this.registry.registerTransactional({ type: kind, schema: SCHEMAS[kind] as z.ZodType<Payload>, handle: (tx, event, effects) => this.handle(tx, kind, event, effects) });
    }
    for (const type of COVERED_ELSEWHERE) this.registry.registerTransactional({ type, schema: z.object({}).passthrough(), handle: () => Promise.resolve() });
  }

  private async handle(tx: TenantTransaction, kind: TicketEventKind, event: ClaimedEvent<Payload>, effects: PostCommitEffects): Promise<void> {
    const tenantId = event.tenantId!;
    const { payload } = event;
    const tenant = await this.facts.tenant(tx, tenantId);
    const ticket = await this.facts.ticket(tx, tenantId, payload.ticketId);
    if (tenant === undefined || ticket === undefined) return;

    const eventFacts = await this.eventFacts(tx, tenantId, kind, payload, ticket);
    if (eventFacts === undefined) return;
    const source = payload.eventId === undefined ? undefined : await this.facts.event(tx, tenantId, payload.eventId);
    // A movement that ends the ticket emits both `ticket.transitioned` and `ticket.closed`: the person hears it once.
    if (kind === 'ticket.transitioned' && ticket.closedAt !== null && source?.createdAt.getTime() === ticket.closedAt.getTime()) return;
    const actorId = source?.actorId ?? null;
    const chosen = chooseRecipients(candidatesFor(kind, eventFacts), actorId);
    const readerIds = new Set(await this.readers.filter(tx, tenantId, payload.ticketId, chosen.map((candidate) => candidate.userId)));
    const recipients = chosen.filter((candidate) => readerIds.has(candidate.userId));
    const stored = await this.recipients.preferences(tx, tenantId, recipients.map((candidate) => candidate.userId), [...new Set(recipients.map((candidate) => candidate.type))]);

    const inApp: NewNotification[] = [];
    const mails: NotificationEmailPayload[] = [];
    for (const recipient of recipients) {
      const channels = channelsFor(stored, recipient.userId, recipient.type);
      if (channels.inApp) inApp.push({ userId: recipient.userId, ticketId: payload.ticketId, type: recipient.type as NotificationTypeValue, sourceEventId: event.id, ...notificationText(recipient.type, ticket) });
      // A suspended organization keeps its in-app notices but sends no e-mail.
      if (channels.email && tenant.active) mails.push({ userId: recipient.userId, notificationType: recipient.type, ticketId: payload.ticketId, sourceEventId: event.id });
    }
    await this.notifications.createMany(tx, tenantId, inApp);
    await this.emails.enqueue(tx, tenantId, mails);
    // After the commit, tell the open screens of these people (ids only; they read their own counter).
    if (inApp.length > 0) {
      const userIds = [...new Set(inApp.map((notification) => notification.userId))];
      effects.afterCommit(() => this.realtime.publish([{ v: 1, k: 'notifications', t: tenantId, u: userIds }]));
    }
  }

  /** `undefined` when the event no longer matters (an SLA clock that finished or a ticket that closed since). */
  private async eventFacts(tx: TenantTransaction, tenantId: string, kind: TicketEventKind, payload: Payload, ticket: { creatorId: string; registeredById: string | null; workflowId: string }): Promise<EventFacts | undefined> {
    const assignees = await this.facts.assignees(tx, tenantId, payload.ticketId);
    const observerIds = NOTIFIES_OBSERVERS.has(kind) ? await this.facts.observerIds(tx, tenantId, ticket.workflowId) : [];
    const common = { creatorId: ticket.creatorId, registeredById: ticket.registeredById, assigneeIds: assignees.map((assignee) => assignee.userId), observerIds };
    switch (kind) {
      case 'ticket.assigned':
        return { ...common, assignedUserId: payload.userId };
      case 'ticket.incident_opened':
      case 'ticket.incident_resolved': {
        const incident = await this.facts.incident(tx, tenantId, payload.incidentId!);
        return incident === undefined ? undefined : { ...common, incidentAssigneeId: incident.assignedToId, incidentOpenerId: incident.createdById };
      }
      case 'sla.overdue': {
        const clock = await this.facts.clock(tx, tenantId, payload.clockId!);
        if (clock === undefined || clock.completedAt !== null || clock.ticketStatus !== 'OPEN') return undefined;
        const pool = assignees.filter((assignee) => assignee.type === 'POOL').map((assignee) => assignee.userId);
        return { ...common, overdueResponsibleIds: clock.responsibleId === null ? pool : [clock.responsibleId] };
      }
      case 'sla.warning': {
        // Too late to warn once the step ended, the ticket stopped, or the clock already went overdue.
        const clock = await this.facts.clock(tx, tenantId, payload.clockId!);
        if (clock === undefined || clock.completedAt !== null || clock.alertedAt !== null || clock.ticketStatus !== 'OPEN') return undefined;
        const pool = assignees.filter((assignee) => assignee.type === 'POOL').map((assignee) => assignee.userId);
        return { ...common, warningResponsibleIds: clock.responsibleId === null ? pool : [clock.responsibleId] };
      }
      default:
        return common;
    }
  }
}
