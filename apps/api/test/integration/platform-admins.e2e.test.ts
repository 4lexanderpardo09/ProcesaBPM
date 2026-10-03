import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform, type PlatformAdminUser } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const personal = () => ({ email: `invited-${Math.random().toString(36).slice(2, 10)}@example.com`, firstName: 'Iris', lastName: 'Invited' });

describe('platform administrators', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: PlatformAdminUser;
  let token: string;
  const http = () => request(app.getHttpServer());
  const auth = (accessToken = token) => bearer(accessToken);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  // Each test starts with exactly one administrator: the "last admin" rule depends on the table's content.
  beforeEach(async () => {
    await db.owner.query('DELETE FROM platform_admins');
    admin = await seedPlatformAdmin(db);
    token = await signInPlatform(app, db, admin);
  });

  describe('GET /platform/admins', () => {
    it('lists administrators without secrets', async () => {
      const response = await http().get('/platform/admins').set(auth()).expect(200);
      expect(response.body).toEqual([expect.objectContaining({ userId: admin.userId, email: admin.email, status: 'ACTIVE', mfaEnabled: true })]);
      expect(JSON.stringify(response.body)).not.toMatch(/password|secret|hash/i);
    });
  });

  describe('POST /platform/admins', () => {
    it('creates the identity, adds the admin, queues the "choose your password" e-mail and audits it', async () => {
      const body = personal();
      const response = await http().post('/platform/admins').set(auth()).send(body).expect(201);
      expect(response.body).toMatchObject({ email: body.email.toLowerCase(), mfaEnabled: false });

      const events = await db.owner.query(`SELECT payload FROM platform_outbox_events WHERE type = 'email.platform_admin_invitation' AND payload ->> 'userId' = $1`, [response.body.userId]);
      expect(events.rows).toHaveLength(1);
      const log = await db.owner.query(`SELECT actor_user_id FROM platform_audit_logs WHERE action = 'platform_admin.invited' AND data ->> 'userId' = $1`, [response.body.userId]);
      expect(log.rows).toEqual([{ actor_user_id: admin.userId }]);
    });

    it('promotes an existing user and refuses a second invitation', async () => {
      const tenant = await seedTenant(db.platform);
      const member = await seedUser(db, tenant);
      await http().post('/platform/admins').set(auth()).send({ email: member.email, firstName: 'Mem', lastName: 'Ber' }).expect(201);
      const again = await http().post('/platform/admins').set(auth()).send({ email: member.email, firstName: 'Mem', lastName: 'Ber' }).expect(409);
      expect(again.body.error.code).toBe('DUPLICATE');
    });

    it('refuses a disabled or locked account and an invalid body', async () => {
      const tenant = await seedTenant(db.platform);
      for (const status of ['DISABLED', 'LOCKED']) {
        const member = await seedUser(db, tenant);
        await db.owner.query(`UPDATE users SET status = $2::user_status WHERE id = $1`, [member.userId, status]);
        await http().post('/platform/admins').set(auth()).send({ email: member.email, firstName: 'Mem', lastName: 'Ber' }).expect(422);
      }
      const member = await seedUser(db, tenant);
      await http().post('/platform/admins').set(auth()).send({ email: 'not-an-email', firstName: '', lastName: 'x' }).expect(400);
    });
  });

  describe('DELETE /platform/admins/:userId', () => {
    it('revokes another admin: their platform token stops working at once and their platform sessions end', async () => {
      const other = await seedPlatformAdmin(db);
      const otherToken = await signInPlatform(app, db, other);
      await http().get('/platform/admins').set(auth(otherToken)).expect(200);

      await http().delete(`/platform/admins/${other.userId}`).set(auth()).expect(204);

      await http().get('/platform/admins').set(auth(otherToken)).expect(401);
      const open = await db.owner.query(`SELECT 1 FROM refresh_sessions WHERE user_id = $1 AND active_tenant_id IS NULL AND revoked_at IS NULL`, [other.userId]);
      expect(open.rowCount).toBe(0);
      const log = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE action = 'platform_admin.revoked' AND data ->> 'userId' = $1`, [other.userId]);
      expect(log.rows).toHaveLength(1);
    });

    it('never removes the last admin, not even oneself', async () => {
      const response = await http().delete(`/platform/admins/${admin.userId}`).set(auth()).expect(409);
      expect(response.body.error.code).toBe('LAST_PLATFORM_ADMIN');
      await http().get('/platform/admins').set(auth()).expect(200);
    });

    it('lets an admin step down while another remains', async () => {
      const other = await seedPlatformAdmin(db);
      await http().delete(`/platform/admins/${admin.userId}`).set(auth()).expect(204);
      await http().get('/platform/admins').set(auth()).expect(401);
      const remaining = await db.owner.query('SELECT user_id FROM platform_admins');
      expect(remaining.rows).toEqual([{ user_id: other.userId }]);
    });

    it('two admins revoking each other at the same time leave one', async () => {
      const other = await seedPlatformAdmin(db);
      const otherToken = await signInPlatform(app, db, other);
      const results = await Promise.all([
        http().delete(`/platform/admins/${other.userId}`).set(auth()),
        http().delete(`/platform/admins/${admin.userId}`).set(auth(otherToken)),
      ]);
      // The loser is refused either by the last-admin rule (409) or, if the winner committed first, because its own session ended (401).
      const [winner, loser] = results.map((r) => r.status).sort((a, b) => a - b);
      expect(winner).toBe(204);
      expect([401, 409]).toContain(loser);
      expect((await db.owner.query('SELECT 1 FROM platform_admins')).rowCount).toBe(1);
    });

    it('does not count an admin who cannot sign in: an invited one who never chose a password does not keep the platform alive', async () => {
      const invited = await http().post('/platform/admins').set(auth()).send(personal()).expect(201);
      const response = await http().delete(`/platform/admins/${admin.userId}`).set(auth()).expect(409);
      expect(response.body.error.code).toBe('LAST_PLATFORM_ADMIN');
      // Once the invited one can sign in (has a password), stepping down is allowed.
      await db.owner.query(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [invited.body.userId]);
      await http().delete(`/platform/admins/${admin.userId}`).set(auth()).expect(204);
    });

    it('an unusable admin can always be removed while a usable one remains', async () => {
      const invited = await http().post('/platform/admins').set(auth()).send(personal()).expect(201);
      await http().delete(`/platform/admins/${invited.body.userId}`).set(auth()).expect(204);
    });

    it('answers 404 for someone who is not an admin', async () => {
      await http().delete('/platform/admins/0198a000-0000-7000-8000-000000000000').set(auth()).expect(404);
    });
  });

  describe('access control', () => {
    it('a tenant user gets 403 and no token gets 401', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await http().get('/platform/admins').set(auth(session.accessToken)).expect(403);
      await http().post('/platform/admins').set(auth(session.accessToken)).send(personal()).expect(403);
      await http().delete(`/platform/admins/${admin.userId}`).set(auth(session.accessToken)).expect(403);
      await http().get('/platform/admins').expect(401);
    });
  });
});
