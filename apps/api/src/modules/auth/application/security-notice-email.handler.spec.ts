import { describe, expect, it, vi } from 'vitest';
import type { WorkerSettings } from '../../../config/worker-settings.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import type { Mailer } from '../../../infrastructure/mail/mailer.js';
import { type ClaimedEvent, PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import type { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { SecurityNoticeKind } from '../../../infrastructure/outbox/platform-event-types.js';
import type { SecurityNoticeRecipient, SecurityNoticeRecipientRepository } from '../data/security-notice-recipient.repository.js';
import { SECURITY_NOTICE_MAX_QUEUE_AGE_MS, SecurityNoticeEmailHandler } from './account-email.handlers.js';

const NOW = new Date('2026-10-03T15:00:00Z');
const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const SESSION_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';
const settings = { WEB_BASE_URL: 'https://app.test', MAIL_MESSAGE_ID_DOMAIN: 'mail.test' } as WorkerSettings;
const RECIPIENT: SecurityNoticeRecipient = { email: 'ana@example.com', firstName: 'Ana', timeZone: null, ipAddress: '203.0.113.7', userAgent: 'Agent/1.0' };

function setup(recipient: SecurityNoticeRecipient | undefined) {
  const recipients = { find: vi.fn().mockResolvedValue(recipient) };
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

const event = (kind: SecurityNoticeKind, createdAt = new Date(NOW.getTime() - 60_000), sessionId?: string): ClaimedEvent<{ userId: string; kind: SecurityNoticeKind; sessionId?: string }> => ({
  id: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
  tenantId: null,
  type: 'email.security_notice',
  attempt: 1,
  claimToken: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae',
  createdAt,
  payload: sessionId === undefined ? { userId: USER_ID, kind } : { userId: USER_ID, kind, sessionId },
});

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
});
