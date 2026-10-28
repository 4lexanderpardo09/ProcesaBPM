import { describe, expect, it, vi } from 'vitest';
import type { WorkerSettings } from '../../../config/worker-settings.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { Mailer } from '../../../infrastructure/mail/mailer.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import type { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { DemoRequestReceivedPayload } from '../../../infrastructure/outbox/platform-event-types.js';
import type { DemoRequestMailRepository } from '../data/demo-request-mail.repository.js';
import { DemoRequestEmailHandler } from './demo-request-email.handler.js';

const EVENT_ID = '0191f0a0-0000-7000-8000-000000000001';
const event = { id: EVENT_ID, payload: { demoRequestId: '0191f0a0-0000-7000-8000-000000000002' } } as ClaimedEvent<DemoRequestReceivedPayload>;
const stored = { fullName: 'Laura Méndez', company: 'Distribuidora del Valle', email: 'laura@example.com', teamSize: 'UNDER_20' as const, process: 'Anticipos', createdAt: new Date() };

function handler(inbox: string | undefined, { gone = false }: { gone?: boolean } = {}) {
  const settings = { SALES_INBOX_EMAIL: inbox, MAIL_MESSAGE_ID_DOMAIN: 'procesabpm.test' } as WorkerSettings;
  const repository = { find: vi.fn(() => Promise.resolve(gone ? undefined : stored)) } as unknown as DemoRequestMailRepository;
  return new DemoRequestEmailHandler(settings, {} as Mailer, repository, {} as OutboxHandlerRegistry);
}

describe('DemoRequestEmailHandler', () => {
  it('mails the sales inbox, with the person as Reply-To and a message id per event', async () => {
    const message = await handler('ventas@example.com').prepare({} as CrossTenantTransaction, event);
    expect(message).toMatchObject({ to: 'ventas@example.com', replyTo: 'laura@example.com', messageId: `<${EVENT_ID}@procesabpm.test>` });
  });

  it('sends nothing without a sales inbox, or once the request is gone', async () => {
    expect(await handler(undefined).prepare({} as CrossTenantTransaction, event)).toBeNull();
    expect(await handler('ventas@example.com', { gone: true }).prepare({} as CrossTenantTransaction, event)).toBeNull();
  });
});
