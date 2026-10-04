import { describe, expect, it, vi } from 'vitest';
import type { WorkerSettings } from '../../../config/worker-settings.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import type { Mailer } from '../../../infrastructure/mail/mailer.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import type { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import type { DataExportReadyPayload } from '../../../infrastructure/outbox/platform-event-types.js';
import type { DataExportNotice, DataExportNoticeRepository } from '../data/data-export-notice.repository.js';
import { DataExportReadyEmailHandler } from './data-export-ready-email.handler.js';

const payload: DataExportReadyPayload = { tenantId: '0199a8f0-0000-7000-8000-00000000000a', exportId: '0199a8f0-0000-7000-8000-00000000000e', userId: '0199a8f0-0000-7000-8000-000000000001' };
const event: ClaimedEvent<DataExportReadyPayload> = { id: '0199a8f0-0000-7000-8000-0000000000ee', tenantId: null, type: 'email.data_export_ready', attempt: 1, claimToken: 'c', createdAt: new Date(), payload };
const settings = { MAIL_MESSAGE_ID_DOMAIN: 'procesabpm.test', WEB_BASE_URL: 'https://app.test' } as WorkerSettings;

function handler(notice: DataExportNotice | undefined) {
  const find = vi.fn(async () => notice);
  const subject = new DataExportReadyEmailHandler(settings, { send: vi.fn() } as unknown as Mailer, new WebLinks(settings), { find } as unknown as DataExportNoticeRepository, {} as OutboxHandlerRegistry);
  return { subject, find };
}

describe('DataExportReadyEmailHandler', () => {
  it('accepts only the three ids', () => {
    const { subject } = handler(undefined);
    expect(subject.schema.safeParse(payload).success).toBe(true);
    expect(subject.schema.safeParse({ ...payload, email: 'attacker@evil.test' }).success).toBe(false);
    expect(subject.schema.safeParse({ tenantId: payload.tenantId, userId: payload.userId }).success).toBe(false);
  });

  it('sends nothing when the database does not vouch for the event (forged, expired, or the person lost access)', async () => {
    const { subject, find } = handler(undefined);
    expect(await subject.prepare({} as never, event)).toBeNull();
    expect(find).toHaveBeenCalledWith({}, payload);
  });

  it('writes in Spanish to the address the database returns, links to the app page and never to the archive', async () => {
    const { subject } = handler({ email: 'owner@acme.test', firstName: 'Ana', timeZone: 'America/Bogota', organization: 'Acme', expiresAt: new Date('2026-10-11T15:00:00Z') });
    const message = (await subject.prepare({} as never, event))!;
    expect(message).toMatchObject({ to: 'owner@acme.test', subject: 'La exportación de datos de tu organización está lista', messageId: `<${event.id}@procesabpm.test>` });
    expect(message.text).toContain('Hola Ana,');
    expect(message.text).toContain('«Acme»');
    expect(message.text).toContain('11 de octubre de 2026');
    expect(message.text).toContain(`https://app.test/data-exports?tenant=${payload.tenantId}`);
    expect(`${message.text}${message.html}`).not.toMatch(/exports\/[0-9a-f-]+\.zip|tenants\//);
  });
});
