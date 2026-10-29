import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { TEST_SALES_INBOX, useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

describe('demo requests from the website', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let adminToken: string;
  let memberToken: string;
  const http = () => request(app.getHttpServer());
  const address = () => `lead-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const form = (email: string, extra: object = {}) => ({
    fullName: 'Laura Méndez',
    company: 'Distribuidora del Valle',
    email,
    teamSize: 'FROM_20_TO_100',
    process: 'Anticipos y legalizaciones',
    privacyConsent: true,
    ...extra,
  });
  // The test app runs without the per-address limit (createTestApp); the database's own limits still apply.
  const submit = (body: object) => http().post('/public/demo-requests').send(body);
  const stored = async (email: string) => (await db.owner.query<{ id: string; status: string }>('SELECT id, status FROM demo_requests WHERE email = $1', [email])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    adminToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    const tenant = await seedTenant(db.platform);
    memberToken = (await signIn(app, (await seedUser(db, tenant)).email, tenant.tenantId)).accessToken;
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('accepts the form without a session and mails the sales inbox, with the person as Reply-To', async () => {
    const email = address();
    await submit(form(email)).expect(202);
    expect(await stored(email)).toHaveLength(1);
    await mail.deliver();
    const message = mail.mailer.to(TEST_SALES_INBOX).find((sent) => sent.replyTo === email);
    expect(message?.subject).toBe('Nuevo pedido de demo desde el sitio web');
    expect(message?.text).toContain('Laura Méndez, de Distribuidora del Valle');
    expect(message?.text).toContain('Anticipos y legalizaciones');
  });

  it('answers the same to a repeat and to a bot, and stores neither', async () => {
    const email = address();
    await submit(form(email)).expect(202);
    await submit(form(email)).expect(202);
    expect(await stored(email)).toHaveLength(1);
    const botEmail = address();
    await submit(form(botEmail, { website: 'http://spam.example' })).expect(202);
    expect(await stored(botEmail)).toEqual([]);
  });

  it('refuses a form without the consent or with invalid data', async () => {
    await submit(form(address(), { privacyConsent: false })).expect(400);
    await submit(form('not-an-email')).expect(400);
    await submit({ email: address() }).expect(400);
  });

  it('the platform console lists them newest first and marks them, auditing who did it', async () => {
    const email = address();
    await submit(form(email)).expect(202);
    const id = (await stored(email))[0]!.id;

    const listed = await http().get('/platform/demo-requests?status=NEW&pageSize=100').set(bearer(adminToken)).expect(200);
    expect(listed.body.items.find((item: { id: string }) => item.id === id)).toMatchObject({ email, status: 'NEW', handledBy: null, teamSize: 'FROM_20_TO_100' });

    const marked = await http().put(`/platform/demo-requests/${id}/status`).set(bearer(adminToken)).send({ status: 'CONTACTED' }).expect(200);
    expect(marked.body).toMatchObject({ id, status: 'CONTACTED' });
    expect(marked.body.handledBy).toEqual(expect.any(String));
    await http().put(`/platform/demo-requests/${id}/status`).set(bearer(adminToken)).send({ status: 'NEW' }).expect(400);

    const audit = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE action = 'demo_request.marked' AND data ->> 'id' = $1`, [id]);
    expect(audit.rows.map((row) => row.data)).toEqual([{ id, status: 'CONTACTED' }]);
  });

  it('the console filters them by when they arrived', async () => {
    const email = address();
    await submit(form(email)).expect(202);
    const id = (await stored(email))[0]!.id;
    await db.owner.query(`UPDATE demo_requests SET created_at = '2026-03-15T12:00:00Z' WHERE id = $1`, [id]);
    const ids = async (from: string, to: string) =>
      ((await http().get('/platform/demo-requests').query({ from, to, pageSize: 100 }).set(bearer(adminToken)).expect(200)).body.items as Array<{ id: string }>).map((item) => item.id);
    expect(await ids('2026-03-15T00:00:00-05:00', '2026-03-16T00:00:00-05:00')).toContain(id);
    expect(await ids('2026-03-16T00:00:00-05:00', '2026-03-17T00:00:00-05:00')).not.toContain(id);
    await http().get('/platform/demo-requests').query({ from: '2026-03-16T00:00:00Z', to: '2026-03-15T00:00:00Z' }).set(bearer(adminToken)).expect(400);
  });

  it('an unknown request is 404, and a member of an organization cannot see them', async () => {
    await http().put('/platform/demo-requests/0191f0a0-0000-7000-8000-000000000000/status').set(bearer(adminToken)).send({ status: 'DISCARDED' }).expect(404);
    await http().get('/platform/demo-requests').set(bearer(memberToken)).expect(403);
  });
});
