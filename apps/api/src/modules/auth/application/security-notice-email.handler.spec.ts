import { describe, expect, it, vi } from 'vitest';
import type { WorkerSettings } from '../../../config/worker-settings.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import type { Mailer } from '../../../infrastructure/mail/mailer.js';
import { type ClaimedEvent, PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import type { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { SecurityNoticeKind, SecurityNoticePayload } from '../../../infrastructure/outbox/platform-event-types.js';
import type { MemberNoticeRecipient, SecurityNoticeRecipient, SecurityNoticeRecipientRepository } from '../data/security-notice-recipient.repository.js';
import { SECURITY_NOTICE_MAX_QUEUE_AGE_MS, SecurityNoticeEmailHandler } from './account-email.handlers.js';

const NOW = new Date('2026-10-03T15:00:00Z');
const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const SESSION_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';
const settings = { WEB_BASE_URL: 'https://app.test', MAIL_MESSAGE_ID_DOMAIN: 'mail.test' } as WorkerSettings;
const RECIPIENT: SecurityNoticeRecipient = { email: 'ana@example.com', firstName: 'Ana', timeZone: null, ipAddress: '203.0.113.7', userAgent: 'Agent/1.0' };

const TENANT_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789af';
const MEMBER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789b0';
const OWNER: MemberNoticeRecipient = { email: 'olga@example.com', firstName: 'Olga', timeZone: null, organization: 'Acme', memberName: 'Ana Ruiz' };

/** `owner: null` = the recipient is no longer an active owner. */
function setup(recipient: SecurityNoticeRecipient | undefined, owner: MemberNoticeRecipient | null = OWNER) {
  const recipients = { find: vi.fn().mockResolvedValue(recipient), findOwner: vi.fn().mockResolvedValue(owner ?? undefined) };
  const handler = new SecurityNoticeEmailHandler(
    settings,
    {} as Mailer,
    new WebLinks(settings),
    recipients as unknown as SecurityNoticeRecipientRepository,
    { now: () => NOW } as Clock,
    {} as OutboxHandlerRegistry,
  );
  return { handler, recipients };
}

const claimed = (payload: SecurityNoticePayload, createdAt = new Date(NOW.getTime() - 60_000)): ClaimedEvent<SecurityNoticePayload> => ({
  id: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
  tenantId: null,
  type: 'email.security_notice',
  attempt: 1,
  claimToken: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae',
  createdAt,
  payload,
});
const event = (kind: SecurityNoticeKind, createdAt?: Date, sessionId?: string) =>
  claimed(sessionId === undefined ? { userId: USER_ID, kind } : { userId: USER_ID, kind, sessionId }, createdAt);
const ownerEvent = (createdAt?: Date) => claimed({ userId: USER_ID, kind: 'MEMBER_MFA_RESET_BY_SUPPORT', tenantId: TENANT_ID, memberId: MEMBER_ID }, createdAt);

const tx = {} as CrossTenantTransaction;

describe('SecurityNoticeEmailHandler.prepare', () => {
  it('mails the account’s address, with the event id as Message-ID and the plain reset page', async () => {
    const { handler, recipients } = setup(RECIPIENT);
    const message = await handler.prepare(tx, event('PLATFORM_ADMIN_SIGN_IN', undefined, SESSION_ID));
    expect(recipients.find).toHaveBeenCalledWith(tx, USER_ID, SESSION_ID);
    expect(message).toMatchObject({ to: 'ana@example.com', messageId: '<018f3c1e-7b2a-7c3d-9e4f-0123456789ad@mail.test>' });
    expect(message?.text).toContain('https://app.test/forgot-password');
    expect(message?.text).toContain('203.0.113.7');
    expect(message?.text).not.toContain('token');
  });

  it('asks without a session when the notice has none', async () => {
    const { handler, recipients } = setup(RECIPIENT);
    await handler.prepare(tx, event('PASSWORD_CHANGED'));
    expect(recipients.find).toHaveBeenCalledWith(tx, USER_ID, null);
  });

  it('sends nothing when there is no recipient (disabled or deleted account)', async () => {
    const { handler } = setup(undefined);
    await expect(handler.prepare(tx, event('MFA_ENABLED'))).resolves.toBeNull();
  });

  it('drops a notice that waited more than 7 days (stale news) as a permanent failure', async () => {
    const { handler, recipients } = setup(RECIPIENT);
    const stale = new Date(NOW.getTime() - SECURITY_NOTICE_MAX_QUEUE_AGE_MS - 1);
    await expect(handler.prepare(tx, event('ACCOUNT_LOCKED', stale))).rejects.toBeInstanceOf(PermanentEventError);
    expect(recipients.find).not.toHaveBeenCalled();
    const almost = new Date(NOW.getTime() - SECURITY_NOTICE_MAX_QUEUE_AGE_MS + 1000);
    await expect(handler.prepare(tx, event('ACCOUNT_LOCKED', almost))).resolves.not.toBeNull();
  });

  it('refuses a payload with anything but the user, the kind and the session', () => {
    const { handler } = setup(RECIPIENT);
    expect(handler.schema.safeParse({ userId: USER_ID, kind: 'PASSWORD_RESET' }).success).toBe(true);
    expect(handler.schema.safeParse({ userId: USER_ID, kind: 'PASSWORD_RESET', email: 'x@example.com' }).success).toBe(false);
    expect(handler.schema.safeParse({ userId: USER_ID, kind: 'SOMETHING_ELSE' }).success).toBe(false);
  });

  describe('notice to an owner about a member', () => {
    it('mails the owner, read with the organization and the member, and never asks for the personal recipient', async () => {
      const { handler, recipients } = setup(RECIPIENT);
      const message = await handler.prepare(tx, ownerEvent());
      expect(recipients.findOwner).toHaveBeenCalledWith(tx, USER_ID, TENANT_ID, MEMBER_ID);
      expect(recipients.find).not.toHaveBeenCalled();
      expect(message).toMatchObject({ to: 'olga@example.com', messageId: '<018f3c1e-7b2a-7c3d-9e4f-0123456789ad@mail.test>' });
      expect(message?.text).toContain('Ana Ruiz');
      expect(message?.text).toContain('Acme');
    });

    it('sends nothing when the recipient is no longer an active owner', async () => {
      const { handler } = setup(RECIPIENT, null);
      await expect(handler.prepare(tx, ownerEvent())).resolves.toBeNull();
    });

    it('drops it as stale news after 7 days too', async () => {
      const { handler } = setup(RECIPIENT);
      await expect(handler.prepare(tx, ownerEvent(new Date(NOW.getTime() - SECURITY_NOTICE_MAX_QUEUE_AGE_MS - 1)))).rejects.toBeInstanceOf(PermanentEventError);
    });

    it('needs the organization and the member, and accepts nothing else', () => {
      const { handler } = setup(RECIPIENT);
      const valid = { userId: USER_ID, kind: 'MEMBER_MFA_RESET_BY_SUPPORT', tenantId: TENANT_ID, memberId: MEMBER_ID };
      expect(handler.schema.safeParse(valid).success).toBe(true);
      expect(handler.schema.safeParse({ ...valid, memberId: undefined }).success).toBe(false);
      expect(handler.schema.safeParse({ ...valid, sessionId: SESSION_ID }).success).toBe(false);
      expect(handler.schema.safeParse({ userId: USER_ID, kind: 'MFA_RESET_BY_SUPPORT', tenantId: TENANT_ID, memberId: MEMBER_ID }).success).toBe(false);
    });
  });
});
