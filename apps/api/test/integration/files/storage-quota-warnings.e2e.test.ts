import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../../support/admin-api.js';
import { createTestApp } from '../../support/create-test-app.js';
import { pdf, uploadFile } from '../../support/file-uploads.js';
import { useTestEnvironment } from '../../support/test-environment.js';
import { type Member, TicketWorld, unique } from '../../support/ticket-world.js';
import { MailWorker } from '../../support/worker-mail.js';

useTestEnvironment();

const LIMIT = 10_000;
/** A PDF of exactly this many bytes. */
const pdfOf = (bytes: number) => {
  const empty = pdf('').length;
  return pdf('x'.repeat(bytes - empty));
};

describe('storage quota warnings (STORAGE_QUOTA at 80 % and 95 %)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let world: TicketWorld;
  let uploader: Member;
  let adminEmail: string;

  const quotaNotices = async (userId: string) =>
    (await db.platform.query<{ ticket_id: string | null; title: string; body: string }>(`SELECT ticket_id, title, body FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND type = 'STORAGE_QUOTA' ORDER BY created_at`, [world.tenant.tenantId, userId])).rows;
  const quotaMails = () => mail.mailer.sent.filter((message) => message.to === adminEmail);
  const level = async () => (await db.platform.query<{ quota_warning_level: number }>('SELECT quota_warning_level FROM tenant_usage WHERE tenant_id = $1', [world.tenant.tenantId])).rows[0]?.quota_warning_level;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    world = await TicketWorld.create(db, app);
    uploader = await world.member([{ action: 'create', subject: 'Ticket' }]);
    adminEmail = (await db.platform.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [world.tenant.userId])).rows[0]!.email;
    const planId = (await db.platform.query<{ id: string }>(`INSERT INTO plans (code, name, storage_base_bytes, storage_per_user_bytes, storage_grace_percent) VALUES ($1, 'Tiny', $2, 0, 50) RETURNING id`, [unique('plan'), LIMIT])).rows[0]!.id;
    await db.platform.query('UPDATE tenants SET plan_id = $1, extra_storage_bytes = 0 WHERE id = $2', [planId, world.tenant.tenantId]);
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('below 80 % nobody is told', async () => {
    await uploadFile(uploader, { name: 'a.pdf', content: pdfOf(7_000) });
    await mail.deliver();
    expect(await quotaNotices(world.tenant.userId)).toEqual([]);
    expect(await level()).toBe(0);
  });

  it('crossing 80 % tells the administrators once, in the app and by e-mail, and not the uploader', async () => {
    await uploadFile(uploader, { name: 'b.pdf', content: pdfOf(1_500) });
    await mail.deliver();
    await uploadFile(uploader, { name: 'c.pdf', content: pdfOf(200) });
    await mail.deliver();
    const notices = await quotaNotices(world.tenant.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ ticket_id: null, title: 'Tu organización se acerca al límite de almacenamiento' });
    expect(notices[0]!.body).toContain('80 %');
    expect(await quotaNotices(uploader.userId)).toEqual([]);
    expect(quotaMails()).toHaveLength(1);
    expect(quotaMails()[0]!.text).toContain('/settings/storage');
    expect(await level()).toBe(80);
  });

  it('crossing 95 % warns again, and an administrator who turned e-mail off only sees it in the app', async () => {
    await db.platform.query(`INSERT INTO notification_preferences (tenant_id, user_id, type, in_app, email) VALUES ($1, $2, 'STORAGE_QUOTA', true, false)`, [world.tenant.tenantId, world.tenant.userId]);
    await uploadFile(uploader, { name: 'd.pdf', content: pdfOf(1_000) });
    await mail.deliver();
    const notices = await quotaNotices(world.tenant.userId);
    expect(notices).toHaveLength(2);
    expect(notices[1]!.body).toContain('95 %');
    expect(quotaMails()).toHaveLength(1);
    expect(await level()).toBe(95);
  });

  it('a larger limit lowers the level silently, so a later crossing is announced again', async () => {
    await db.platform.query('UPDATE tenants SET extra_storage_bytes = $2 WHERE id = $1', [world.tenant.tenantId, 2 * LIMIT]);
    await uploadFile(uploader, { name: 'e.pdf', content: pdfOf(100) });
    await mail.deliver();
    expect(await level()).toBe(0);
    expect(await quotaNotices(world.tenant.userId)).toHaveLength(2);
  });
});
