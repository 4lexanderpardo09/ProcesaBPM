import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker, tokenOf } from '../support/worker-mail.js';

useTestEnvironment();

describe('the invitation e-mail of a platform administrator', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let token: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('reaches the invitee with a link that lasts days, and the link sets the password', async () => {
    const email = `invitee-${Math.random().toString(36).slice(2, 10)}@example.com`;
    await http().post('/platform/admins').set(bearer(token)).send({ email, firstName: 'Iris', lastName: 'Invited' }).expect(201);
    const message = await mail.waitForMail(email);
    expect(message.subject).toContain('administrar');
    const { rows } = await db.owner.query(`SELECT extract(epoch FROM expires_at - now()) / 86400 AS days FROM user_tokens WHERE type = 'PASSWORD_RESET' AND user_id = (SELECT id FROM users WHERE email = $1) AND consumed_at IS NULL`, [email]);
    expect(Number(rows[0].days)).toBeGreaterThan(6.9);
    await http().post('/auth/password-reset/confirm').send({ token: tokenOf(message), newPassword: 'a password chosen by the invitee 1' }).expect(204);
  });

  it('is still sent after waiting more than an hour in the queue', async () => {
    const email = `late-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const created = await http().post('/platform/admins').set(bearer(token)).send({ email, firstName: 'Late', lastName: 'Invitee' }).expect(201);
    await db.owner.query(`UPDATE platform_outbox_events SET created_at = now() - interval '3 hours' WHERE type = 'email.platform_admin_invitation' AND payload ->> 'userId' = $1`, [created.body.userId]);
    expect((await mail.waitForMail(email)).to).toBe(email);
  });
});
