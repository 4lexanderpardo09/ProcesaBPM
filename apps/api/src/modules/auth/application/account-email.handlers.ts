import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import { INVITATION_EVENT, invitationPayloadSchema, PASSWORD_RESET_EVENT, passwordResetPayloadSchema, PLATFORM_ADMIN_INVITATION_EVENT, platformAdminInvitationPayloadSchema, type MemberSecurityNoticePayload, type PersonalSecurityNoticePayload, SECURITY_NOTICE_EVENT, type SecurityNoticePayload, securityNoticePayloadSchema, TENANT_DELETION_REQUESTED_EVENT, tenantDeletionRequestedPayloadSchema } from '../../../infrastructure/outbox/platform-event-types.js';
import { type ClaimedEvent, type ExternalEffectHandler, PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { Clock } from '../../../infrastructure/clock.js';
import { SecurityNoticeRecipientRepository } from '../data/security-notice-recipient.repository.js';
import { WorkerTokenRepository } from '../data/worker-token.repository.js';
import { INVITATION_VALIDITY_DAYS, PASSWORD_RESET_VALIDITY_MINUTES, PLATFORM_ADMIN_INVITATION_VALIDITY_DAYS, renderInvitationEmail, renderMemberSecurityNoticeEmail, renderPasswordResetEmail, renderPlatformAdminInvitationEmail, renderSecurityNoticeEmail, renderTenantDeletionEmail, type RenderedMail } from '../domain/auth-email-templates.js';
import { deriveEmailLinkToken } from '../domain/email-link-token.js';

/** A reset request that waited longer than this in the queue is not mailed: the person asked again by now. */
export const PASSWORD_RESET_MAX_QUEUE_AGE_MS = 60 * 60 * 1000;

/** A security notice that waited longer than this is stale news and is not mailed. */
export const SECURITY_NOTICE_MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** The e-mail of a new platform administrator: a password link that lasts days, never dropped for waiting in the queue. */
@Injectable()
export class PlatformAdminInvitationEmailHandler extends AccountEmailHandler<ResetPayload> implements ExternalEffectHandler<ResetPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = PLATFORM_ADMIN_INVITATION_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = platformAdminInvitationPayloadSchema;

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

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<ResetPayload>): Promise<MailMessage | null> {
    const token = this.tokenFor(event);
    const ttlMinutes = PLATFORM_ADMIN_INVITATION_VALIDITY_DAYS * 24 * 60;
    const recipient = await this.tokens.issuePasswordReset(tx, { eventId: event.id, userId: event.payload.userId, tokenHash: sha256Hex(token), ttlMinutes });
    if (recipient === undefined) return null;
    return this.message(event, recipient.email, renderPlatformAdminInvitationEmail({ firstName: recipient.firstName, url: this.links.resetPassword(token) }));
  }
}

/** Tells the owner that the deletion of the organization was requested and when it becomes final. */
@Injectable()
export class TenantDeletionEmailHandler extends AccountEmailHandler<InvitationPayload> implements ExternalEffectHandler<InvitationPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = TENANT_DELETION_REQUESTED_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = tenantDeletionRequestedPayloadSchema;

  constructor(
    @Inject(WORKER_SETTINGS) settings: WorkerSettings,
    @Inject(Mailer) mailer: Mailer,
    @Inject(WorkerTokenRepository) private readonly tokens: WorkerTokenRepository,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {
    super(settings, mailer);
  }

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<InvitationPayload>): Promise<MailMessage | null> {
    const notice = await this.tokens.tenantDeletionNotice(tx, event.payload.tenantId, event.payload.userId);
    if (notice === undefined) return null;
    return this.message(event, notice.email, renderTenantDeletionEmail(notice));
  }
}

/**
 * Tells the user about a change to the security of their account, or the owner of an organization about one made by
 * support to one of its members. The worker reads the addresses; no token, no secret link.
 */
@Injectable()
export class SecurityNoticeEmailHandler extends AccountEmailHandler<SecurityNoticePayload> implements ExternalEffectHandler<SecurityNoticePayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = SECURITY_NOTICE_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = securityNoticePayloadSchema;

  constructor(
    @Inject(WORKER_SETTINGS) settings: WorkerSettings,
    @Inject(Mailer) mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(SecurityNoticeRecipientRepository) private readonly recipients: SecurityNoticeRecipientRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {
    super(settings, mailer);
  }

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<SecurityNoticePayload>): Promise<MailMessage | null> {
    if (this.clock.now().getTime() - event.createdAt.getTime() > SECURITY_NOTICE_MAX_QUEUE_AGE_MS) throw new PermanentEventError('The security notice is too old to be mailed');
    const { payload } = event;
    return payload.kind === 'MEMBER_MFA_RESET_BY_SUPPORT' ? this.prepareForOwner(tx, event, payload) : this.prepareForUser(tx, event, payload);
  }

  private async prepareForUser(tx: CrossTenantTransaction, event: ClaimedEvent<SecurityNoticePayload>, payload: PersonalSecurityNoticePayload): Promise<MailMessage | null> {
    const recipient = await this.recipients.find(tx, payload.userId, payload.sessionId ?? null);
    if (recipient === undefined) return null;
    const mail = renderSecurityNoticeEmail({
      kind: payload.kind,
      firstName: recipient.firstName,
      occurredAt: event.createdAt,
      timeZone: recipient.timeZone,
      origin: { ipAddress: recipient.ipAddress, userAgent: recipient.userAgent },
      resetUrl: this.links.forgotPassword(),
    });
    return this.message(event, recipient.email, mail);
  }

  private async prepareForOwner(tx: CrossTenantTransaction, event: ClaimedEvent<SecurityNoticePayload>, payload: MemberSecurityNoticePayload): Promise<MailMessage | null> {
    const recipient = await this.recipients.findOwner(tx, payload.userId, payload.tenantId, payload.memberId);
    if (recipient === undefined) return null;
    const mail = renderMemberSecurityNoticeEmail({
      kind: payload.kind,
      firstName: recipient.firstName,
      organization: recipient.organization,
      memberName: recipient.memberName,
      occurredAt: event.createdAt,
      timeZone: recipient.timeZone,
    });
    return this.message(event, recipient.email, mail);
  }
}
