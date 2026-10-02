import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackgroundTasks } from '../../src/common/background/background-tasks.js';
import { sha256Hex } from '../../src/infrastructure/security/token-utils.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { inviteUser, membershipStatus, seedUser, type TestUser, userRow } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker, tokenOf } from '../support/worker-mail.js';

useTestEnvironment();

const NEW_PASSWORD = 'a brand new passphrase';

interface ResetEmail {
  payload: { userId: string };
}

describe('one-time tokens', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  let mail: MailWorker;

  const http = () => request(app.getHttpServer());
  /** The request answers at once and does its work in the background; this waits for that work. */
  const requestReset = async (email: string, expectedStatus = 202) => {
    const response = await http().post('/auth/password-reset/request').send({ email }).expect(expectedStatus);
    await app.get(BackgroundTasks).whenIdle();
    return response;
  };
  const confirmReset = (token: string, newPassword = NEW_PASSWORD) =>
    http().post('/auth/password-reset/confirm').send({ token, newPassword });
  const login = (email: string, password: string) => http().post('/auth/login').send({ email, password });

  /** The platform outbox is not readable by the API's role: read it as the schema owner. */
  async function resetEmails(userId: string): Promise<ResetEmail[]> {
    const { rows } = await db.owner.query<{ payload: ResetEmail['payload'] }>(
      `SELECT payload FROM platform_outbox_events
       WHERE type = 'email.password_reset' AND payload ->> 'userId' = $1 ORDER BY created_at`,
      [userId],
    );
    return rows.map((row) => ({ payload: row.payload }));
  }

  /** Requests a reset, lets the worker deliver it and returns the token of the link it mailed. */
  async function resetTokenFor(user: TestUser): Promise<string> {
    await requestReset(user.email);
    await mail.deliver({ retries: true });
    return tokenOf(mail.lastTo(user.email)!);
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('POST /auth/password-reset/request', () => {
    it('answers 202 with no body for an unknown e-mail and queues nothing', async () => {
      const { rows: before } = await db.owner.query(`SELECT count(*)::int AS n FROM platform_outbox_events`);
      const response = await requestReset(`nobody-${Date.now()}@example.com`);
      expect(response.text).toBe('');
      const { rows: after } = await db.owner.query(`SELECT count(*)::int AS n FROM platform_outbox_events`);
      expect(after[0].n).toBe(before[0].n);
    });

    it('queues only the user id; the worker then issues a 30-minute token and mails the link, and the clear token is stored nowhere', async () => {
      const user = await seedUser(db, tenant);
      const response = await requestReset(user.email);
      expect(response.text).toBe('');

      const [event] = await resetEmails(user.userId);
      expect(event!.payload).toEqual({ userId: user.userId });
      expect((await db.platform.query('SELECT 1 FROM user_tokens WHERE user_id = $1', [user.userId])).rowCount).toBe(0);

      await mail.deliver();
      const message = mail.lastTo(user.email)!;
      expect(message.subject).toBe('Restablece tu contraseña de ProcesaBPM');
      const token = tokenOf(message);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(message.text).toContain(`http://web.test/reset-password#token=${token}`);

      const { rows } = await db.platform.query<{ token_hash: string; type: string; expires_at: Date }>('SELECT token_hash, type, expires_at FROM user_tokens WHERE user_id = $1', [user.userId]);
      expect(rows).toEqual([{ token_hash: sha256Hex(token), type: 'PASSWORD_RESET', expires_at: expect.any(Date) }]);
      expect((rows[0]!.expires_at.getTime() - Date.now()) / 60_000).toBeCloseTo(30, 0);
      const stored = await db.owner.query(`SELECT 1 FROM platform_outbox_events WHERE payload::text LIKE $1 UNION ALL SELECT 1 FROM user_tokens WHERE token_hash = $2`, [`%${token}%`, token]);
      expect(stored.rowCount).toBe(0);
    });

    it('a retry after a failed delivery sends the same link and issues no second token', async () => {
      const user = await seedUser(db, tenant);
      await requestReset(user.email);
      mail.mailer.failNext(new Error('smtp down'));
      await mail.deliver();
      expect(mail.mailer.to(user.email)).toHaveLength(0);
      await db.owner.query(`UPDATE platform_outbox_events SET available_at = now() WHERE payload ->> 'userId' = $1`, [user.userId]);
      await mail.deliver();
      expect(mail.mailer.to(user.email)).toHaveLength(1);
      expect((await db.platform.query('SELECT 1 FROM user_tokens WHERE user_id = $1', [user.userId])).rowCount).toBe(1);
      const state = await db.owner.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM platform_outbox_events WHERE payload ->> 'userId' = $1`, [user.userId]);
      expect(state.rows[0]).toEqual({ status: 'DONE', attempts: 2 });
    });

    it('queues the e-mail even when the user belongs to no organization', async () => {
      const user = await seedUser(db, tenant);
      await db.platform.query('DELETE FROM memberships WHERE user_id = $1', [user.userId]);
      await confirmReset(await resetTokenFor(user)).expect(204);
    });

    it('the event is queued by the request and the API role cannot read the outbox', async () => {
      const user = await seedUser(db, tenant);
      await requestReset(user.email);
      expect(await resetEmails(user.userId)).toHaveLength(1);
      await expect(db.runtime.query('SELECT * FROM platform_outbox_events')).rejects.toMatchObject({ code: '42501' });
    });

    it('does nothing for a disabled account, with the same answer', async () => {
      const user = await seedUser(db, tenant);
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [user.userId]);
      await requestReset(user.email);
      expect(await resetEmails(user.userId)).toEqual([]);
    });

    it('validates the e-mail', async () => {
      const response = await requestReset('not-an-email', 400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('sets the new password, clears the lockout and revokes the sessions', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await db.platform.query(`UPDATE users SET failed_logins = 5, locked_until = now() + interval '15 minutes' WHERE id = $1`, [user.userId]);

      await confirmReset(await resetTokenFor(user)).expect(204);

      await login(user.email, user.password).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
      expect(await userRow(db, user.userId)).toMatchObject({ failed_logins: 0, locked_until: null });
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(401);
      await http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
    });

    it('a token works only once', async () => {
      const user = await seedUser(db, tenant);
      const token = await resetTokenFor(user);
      await confirmReset(token).expect(204);
      const response = await confirmReset(token, 'yet another passphrase').expect(400);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
      await login(user.email, NEW_PASSWORD).expect(200);
    });

    it('an expired token is refused', async () => {
      const user = await seedUser(db, tenant);
      const token = await resetTokenFor(user);
      await db.platform.query(`UPDATE user_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [sha256Hex(token)]);
      const response = await confirmReset(token).expect(400);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
      await login(user.email, user.password).expect(200);
    });

    it('an unknown token is refused', async () => {
      const response = await confirmReset('x'.repeat(43)).expect(400);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('applies the password policy without spending the token', async () => {
      const user = await seedUser(db, tenant);
      const token = await resetTokenFor(user);
      const response = await confirmReset(token, 'short').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      await confirmReset(token).expect(204);
    });

    it('an invitation token is not a password reset token', async () => {
      const invited = await inviteUser(db, tenant, `invitee-${Date.now()}@example.com`);
      await confirmReset(invited.token).expect(400);
      expect(await membershipStatus(db, tenant.tenantId, invited.userId)).toBe('INVITED');
    });
  });

  describe('POST /auth/invitations/accept', () => {
    const accept = (body: { token: string; password?: string }) => http().post('/auth/invitations/accept').send(body);

    it('a new user chooses a password: the membership becomes ACTIVE and the user can sign in', async () => {
      const email = `new-${Date.now()}@example.com`;
      const invited = await inviteUser(db, tenant, email);
      const response = await accept({ token: invited.token, password: NEW_PASSWORD }).expect(200);
      expect(response.body).toEqual({ tenantId: tenant.tenantId });
      expect(await membershipStatus(db, tenant.tenantId, invited.userId)).toBe('ACTIVE');
      const session = await signIn(app, email, tenant.tenantId, NEW_PASSWORD);
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);
    });

    it('a new user without a password is refused and the token stays usable', async () => {
      const invited = await inviteUser(db, tenant, `nopass-${Date.now()}@example.com`);
      const response = await accept({ token: invited.token }).expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
      await accept({ token: invited.token, password: NEW_PASSWORD }).expect(200);
    });

    it('an existing user who sends a password is refused (422) and the password does not change', async () => {
      const user = await seedUser(db, tenant);
      const other = await seedTenant(db.platform);
      const invited = await inviteUser(db, other, user.email);
      const before = await userRow(db, user.userId);
      const response = await accept({ token: invited.token, password: 'attacker chosen password' }).expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
      expect((await userRow(db, user.userId)).password_hash).toBe(before.password_hash);
      expect(await membershipStatus(db, other.tenantId, user.userId)).toBe('INVITED');
      await login(user.email, 'attacker chosen password').expect(401);
      await login(user.email, user.password).expect(200);
    });

    it('an existing user joins another tenant and keeps the password', async () => {
      const user = await seedUser(db, tenant);
      const other = await seedTenant(db.platform);
      const invited = await inviteUser(db, other, user.email);
      expect(invited.userId).toBe(user.userId);
      await accept({ token: invited.token }).expect(200);
      expect(await membershipStatus(db, other.tenantId, user.userId)).toBe('ACTIVE');
      await signIn(app, user.email, other.tenantId, user.password);
    });

    it('a token works only once', async () => {
      const invited = await inviteUser(db, tenant, `once-${Date.now()}@example.com`);
      await accept({ token: invited.token, password: NEW_PASSWORD }).expect(200);
      const response = await accept({ token: invited.token, password: NEW_PASSWORD }).expect(400);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('a password reset token is not an invitation token', async () => {
      const user = await seedUser(db, tenant);
      await accept({ token: await resetTokenFor(user), password: NEW_PASSWORD }).expect(400);
      await login(user.email, user.password).expect(200);
    });
  });
});
