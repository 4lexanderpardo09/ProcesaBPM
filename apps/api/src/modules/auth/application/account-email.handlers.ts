import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import { INVITATION_EVENT, invitationPayloadSchema, PASSWORD_RESET_EVENT, passwordResetPayloadSchema } from '../../../infrastructure/outbox/platform-event-types.js';
import { type ClaimedEvent, type ExternalEffectHandler, PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTokenRepository } from '../data/worker-token.repository.js';
import { INVITATION_VALIDITY_DAYS, PASSWORD_RESET_VALIDITY_MINUTES, renderInvitationEmail, renderPasswordResetEmail, type RenderedMail } from '../domain/auth-email-templates.js';
import { deriveEmailLinkToken } from '../domain/email-link-token.js';

/** A reset request that waited longer than this in the queue is not mailed: the person asked again by now. */
export const PASSWORD_RESET_MAX_QUEUE_AGE_MS = 60 * 60 * 1000;

abstract class AccountEmailHandler<P> {
  constructor(
    protected readonly settings: WorkerSettings,
    private readonly mailer: Mailer,
  ) {}

  async perform(message: MailMessage): Promise<void> {
    await this.mailer.send(message);
  }

  protected message(event: ClaimedEvent<P>, to: string, mail: RenderedMail): MailMessage {
    return { to, ...mail, messageId: `<${event.id}@${this.settings.MAIL_MESSAGE_ID_DOMAIN}>` };
  }

  protected tokenFor(event: ClaimedEvent<P>): string {
    return deriveEmailLinkToken(this.settings.OUTBOX_TOKEN_KEY, event.id);
  }
}

type ResetPayload = { userId: string };
type InvitationPayload = { tenantId: string; userId: string };

@Injectable()
export class PasswordResetEmailHandler extends AccountEmailHandler<ResetPayload> implements ExternalEffectHandler<ResetPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = PASSWORD_RESET_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = passwordResetPayloadSchema;

  constructor(
    @Inject(WORKER_SETTINGS) settings: WorkerSettings,
    @Inject(Mailer) mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(WorkerTokenRepository) private readonly tokens: WorkerTokenRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {
    super(settings, mailer);
  }

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<ResetPayload>): Promise<MailMessage | null> {
    if (this.clock.now().getTime() - event.createdAt.getTime() > PASSWORD_RESET_MAX_QUEUE_AGE_MS) throw new PermanentEventError('The reset request is too old to be mailed');
    const token = this.tokenFor(event);
    const recipient = await this.tokens.issuePasswordReset(tx, { eventId: event.id, userId: event.payload.userId, tokenHash: sha256Hex(token), ttlMinutes: PASSWORD_RESET_VALIDITY_MINUTES });
    if (recipient === undefined) return null;
    return this.message(event, recipient.email, renderPasswordResetEmail({ firstName: recipient.firstName, url: this.links.resetPassword(token) }));
  }
}

@Injectable()
export class InvitationEmailHandler extends AccountEmailHandler<InvitationPayload> implements ExternalEffectHandler<InvitationPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = INVITATION_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = invitationPayloadSchema;

  constructor(
    @Inject(WORKER_SETTINGS) settings: WorkerSettings,
    @Inject(Mailer) mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(WorkerTokenRepository) private readonly tokens: WorkerTokenRepository,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {
    super(settings, mailer);
  }

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<InvitationPayload>): Promise<MailMessage | null> {
    const token = this.tokenFor(event);
    const recipient = await this.tokens.issueInvitation(tx, { eventId: event.id, tenantId: event.payload.tenantId, userId: event.payload.userId, tokenHash: sha256Hex(token), ttlDays: INVITATION_VALIDITY_DAYS });
    if (recipient === undefined) return null;
    return this.message(event, recipient.email, renderInvitationEmail({ firstName: recipient.firstName, organization: recipient.organization, url: this.links.acceptInvitation(token) }));
  }
}
