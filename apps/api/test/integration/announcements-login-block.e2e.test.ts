import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LoginBlockRegistry } from '../../src/modules/announcements/application/login-block-registry.js';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { bearer, logIn, REFRESH_COOKIE_NAME, refreshSetCookieOf, signIn, TEST_PASSWORD } from '../support/auth-helpers.js';
import { addMembership, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, logInWithMfa, rewindReplayGuard } from '../support/mfa-fixtures.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { connectError, connectSocket, startListening } from '../support/realtime-client.js';
import { grantSupport, openSupportSession, verifiedAdminOf } from '../support/support-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const MINUTE = 60_000;
const at = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * MINUTE).toISOString();

interface Announcement {
  readonly id: string;
  readonly endsAt: string | null;
}

describe('announcements that block sign-in', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let url: string;
  let platformToken: string;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());

  /** Through the console, which drops this instance's cache (other instances would see it within 30 s). */
  const announce = async (body: object): Promise<Announcement> =>
    (
      await http()
        .post('/platform/announcements')
        .set(bearer(platformToken))
        .send({ type: 'MAINTENANCE', title: 'Planned maintenance', body: 'Back in one hour', startsAt: at(-1), endsAt: at(60), blocksLogin: true, ...body })
        .expect(201)
    ).body as Announcement;
  const withdraw = (announcement: Announcement) => http().delete(`/platform/announcements/${announcement.id}`).set(bearer(platformToken)).expect(204);
  const clearAnnouncements = async () => {
    await db.owner.query('DELETE FROM platform_announcements');
    app.get(LoginBlockRegistry).invalidate();
  };
  const login = (user: TestUser) => http().post('/auth/login').send({ email: user.email, password: TEST_PASSWORD });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    url = await startListening(app);
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await clearAnnouncements();
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await clearAnnouncements();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('an announcement for every organization', () => {
    it('refuses a member with a right password: 503 MAINTENANCE with the announcement and Retry-After, the attempt given back', async () => {
      const user = await seedUser(db, tenantA);
      const announcement = await announce({});

      const response = await login(user).expect(503);

      expect(response.body.error).toMatchObject({
        code: 'MAINTENANCE',
        details: { announcementId: announcement.id, title: 'Planned maintenance', body: 'Back in one hour', endsAt: announcement.endsAt },
      });
      const retryAfter = Number(response.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(3_500);
      expect(retryAfter).toBeLessThanOrEqual(3_600);
      const { rows } = await db.owner.query('SELECT failed_logins, last_login_at FROM users WHERE id = $1', [user.userId]);
      expect(rows[0]).toEqual({ failed_logins: 0, last_login_at: null });
    });

    it('still answers a wrong password with 401 INVALID_CREDENTIALS: the block shows only after the password', async () => {
      const user = await seedUser(db, tenantA);
      await announce({});
      const response = await http().post('/auth/login').send({ email: user.email, password: 'not the password' }).expect(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      await http().post('/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD }).expect(401);
    });

    it('omits Retry-After when the announcement has no end', async () => {
      const user = await seedUser(db, tenantA);
      await announce({ endsAt: null });
      const response = await login(user).expect(503);
      expect(response.headers['retry-after']).toBeUndefined();
      expect(response.body.error.details.endsAt).toBeNull();
    });

    it('lets platform administrators sign in and use the console', async () => {
      await announce({});
      const token = await signInPlatform(app, db, await seedPlatformAdmin(db));
      await http().get('/platform/announcements').set(bearer(token)).expect(200);
      await http().get('/platform/announcements').set(bearer(platformToken)).expect(200);
    });

    it('refuses the second factor too, without burning the challenge or counting an attempt', async () => {
      const user = await seedUser(db, tenantA);
      const mfa = await enableMfa(db, user.userId);
      await rewindReplayGuard(db, user.userId);
      const challenge = (await login(user).expect(200)).body.challengeToken as string;

      const announcement = await announce({});
      await login(user).expect(503);
      const refused = await http().post('/auth/login/mfa').set(bearer(challenge)).send({ code: currentCode(mfa.secret) }).expect(503);
      expect(refused.body.error.code).toBe('MAINTENANCE');

      await withdraw(announcement);
      const verified = await http().post('/auth/login/mfa').set(bearer(challenge)).send({ code: currentCode(mfa.secret) }).expect(200);
      expect(verified.body.step).toBe('SELECT_ORGANIZATION');
    });

    it('stops existing sessions (requests, refresh and the realtime handshake) and lets them work again afterwards', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      const announcement = await announce({});

      expect((await http().get('/auth/me').set(bearer(session.accessToken)).expect(503)).body.error.code).toBe('MAINTENANCE');
      const refresh = await http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(503);
      expect(refreshSetCookieOf(refresh)).toBeUndefined();
      const socket = connectSocket(url, session.accessToken);
      sockets.push(socket);
      expect(await connectError(socket)).toMatchObject({ code: 'MAINTENANCE' });

      await withdraw(announcement);
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);
      await http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(200);
    });

    it('lets a support visit keep reading the organization', async () => {
      await grantEverything(db, tenantB);
      const admin = await verifiedAdminOf(app, db, tenantB);
      await grantSupport(app, admin.accessToken).expect(201);
      await announce({});

      const visit = (await openSupportSession(app, platformToken, tenantB.tenantId).expect(201)).body as { accessToken: string };
      await http().get('/companies').set(bearer(visit.accessToken)).expect(200);
      await http().get('/companies').set(bearer(admin.accessToken)).expect(503);
    });

    it('refuses the forced enrollment confirmation too, without burning the challenge', async () => {
      const policyTenant = await seedTenant(db.platform);
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [policyTenant.tenantId]);
      const user = await seedUser(db, policyTenant);
      const first = await login(user).expect(200);
      expect(first.body.step).toBe('MFA_ENROLLMENT_REQUIRED');
      const challenge = first.body.challengeToken as string;
      const begun = await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200);
      const secret = base32Decode(begun.body.secret as string);

      const announcement = await announce({});
      const refused = await http().post('/auth/login/mfa/enrollment/confirm').set(bearer(challenge)).send({ code: currentCode(secret) }).expect(503);
      expect(refused.body.error.code).toBe('MAINTENANCE');
      const { rows } = await db.owner.query('SELECT mfa_enabled FROM users WHERE id = $1', [user.userId]);
      expect(rows[0]).toEqual({ mfa_enabled: false });

      await withdraw(announcement);
      const confirmed = await http().post('/auth/login/mfa/enrollment/confirm').set(bearer(challenge)).send({ code: currentCode(secret) }).expect(200);
      expect(confirmed.body.step).toBe('SELECT_ORGANIZATION');
    });

    it('still answers a revoked session or an inactive membership with 401 (and clears the cookie), not 503', async () => {
      const revoked = await signIn(app, (await seedUser(db, tenantA)).email, tenantA.tenantId);
      const deactivated = await seedUser(db, tenantA);
      const inactive = await signIn(app, deactivated.email, tenantA.tenantId);
      await http().post('/auth/logout').set('cookie', revoked.refreshCookie).expect(204);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenantA.tenantId, deactivated.userId]);
      await announce({});

      for (const session of [revoked, inactive]) {
        expect((await http().get('/auth/me').set(bearer(session.accessToken)).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
        const refresh = await http().post('/auth/refresh').set('cookie', session.refreshCookie).expect(401);
        expect(refreshSetCookieOf(refresh)).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=;`));
      }
    });

    it('does not block before it starts, and does not block when it does not ask to', async () => {
      const user = await seedUser(db, tenantA);
      await announce({ startsAt: at(60), endsAt: at(120) });
      await announce({ blocksLogin: false });
      await logIn(app, user.email);
    });
  });

  describe('an announcement for some organizations', () => {
    it('marks only that organization in the sign-in list, and selecting it answers 503 without spending the selection token', async () => {
      const user = await seedUser(db, tenantA);
      await addMembership(db, tenantB, user.userId);
      const announcement = await announce({ audience: 'TENANTS', tenantIds: [tenantA.tenantId] });

      const listed = await login(user).expect(200);
      const maintenanceOf = (tenantId: string) => listed.body.organizations.find((organization: { tenantId: string }) => organization.tenantId === tenantId).maintenance;
      expect(maintenanceOf(tenantA.tenantId)).toEqual({ title: 'Planned maintenance', endsAt: announcement.endsAt });
      expect(maintenanceOf(tenantB.tenantId)).toBeNull();

      const selectionToken = listed.body.selectionToken as string;
      const refused = await http().post('/auth/select-tenant').set(bearer(selectionToken)).send({ tenantId: tenantA.tenantId }).expect(503);
      expect(refused.body.error.details.announcementId).toBe(announcement.id);
      await http().post('/auth/select-tenant').set(bearer(selectionToken)).send({ tenantId: tenantB.tenantId }).expect(200);
    });

    it('refuses a platform administrator entering the blocked organization as a member (the console stays open)', async () => {
      const admin = await seedPlatformAdmin(db);
      await addMembership(db, tenantA, admin.userId);
      await announce({ audience: 'TENANTS', tenantIds: [tenantA.tenantId] });

      const selectionToken = await logInWithMfa(app, db, admin, admin.mfa);
      const refused = await http().post('/auth/select-tenant').set(bearer(selectionToken)).send({ tenantId: tenantA.tenantId }).expect(503);
      expect(refused.body.error.code).toBe('MAINTENANCE');
      await http().post('/auth/platform/select').set(bearer(selectionToken)).expect(200);
    });

    it('stops the sessions of that organization only', async () => {
      const inA = await signIn(app, (await seedUser(db, tenantA)).email, tenantA.tenantId);
      const inB = await signIn(app, (await seedUser(db, tenantB)).email, tenantB.tenantId);
      await announce({ audience: 'TENANTS', tenantIds: [tenantA.tenantId] });

      await http().get('/auth/me').set(bearer(inA.accessToken)).expect(503);
      await http().get('/auth/me').set(bearer(inB.accessToken)).expect(200);
    });

    describe('tenant leak', () => {
      it('tells a non-member nothing: their sign-in list has no notice, and selecting the blocked organization is 401, not 503', async () => {
        const outsider = await seedUser(db, tenantB);
        await announce({ audience: 'TENANTS', tenantIds: [tenantA.tenantId] });

        const listed = await login(outsider).expect(200);
        expect(listed.body.organizations.map((organization: { maintenance: unknown }) => organization.maintenance)).toEqual([null]);
        expect(JSON.stringify(listed.body)).not.toContain('Planned maintenance');
        const refused = await http().post('/auth/select-tenant').set(bearer(listed.body.selectionToken)).send({ tenantId: tenantA.tenantId }).expect(401);
        expect(refused.body.error.code).toBe('UNAUTHENTICATED');
      });

      it("shows a targeted announcement to its organization's members only", async () => {
        const inA = await signIn(app, (await seedUser(db, tenantA)).email, tenantA.tenantId);
        const inB = await signIn(app, (await seedUser(db, tenantB)).email, tenantB.tenantId);
        await announce({ type: 'INFO', title: 'Only for A', blocksLogin: false, audience: 'TENANTS', tenantIds: [tenantA.tenantId] });
        await announce({ type: 'INFO', title: 'For everybody', blocksLogin: false });

        const titlesFor = async (token: string) => ((await http().get('/announcements').set(bearer(token)).expect(200)).body as Array<{ title: string }>).map((a) => a.title).sort();
        expect(await titlesFor(inA.accessToken)).toEqual(['For everybody', 'Only for A']);
        expect(await titlesFor(inB.accessToken)).toEqual(['For everybody']);
        const listedToA = (await http().get('/announcements').set(bearer(inA.accessToken)).expect(200)).body as object[];
        expect(listedToA.every((announcement) => !('tenantIds' in announcement) && !('audience' in announcement))).toBe(true);
      });

      it('lists on the public sign-in banner only the sign-in blocks for every organization, from memory', async () => {
        await announce({ type: 'INFO', title: 'Only for A', blocksLogin: false, audience: 'TENANTS', tenantIds: [tenantA.tenantId] });
        await announce({ title: 'Blocking A', audience: 'TENANTS', tenantIds: [tenantA.tenantId] });
        await announce({ type: 'INFO', title: 'News for members', blocksLogin: false });
        await announce({ type: 'RELEASE_NOTES', title: 'Release notes', blocksLogin: false });
        await announce({ title: 'Tomorrow', startsAt: at(60 * 20), endsAt: at(60 * 21) });
        const global = await announce({ title: 'Global maintenance' });

        const response = await http().get('/announcements/login').expect(200);
        expect(response.headers['cache-control']).toBe('public, max-age=30');
        expect(response.body).toEqual([
          { id: global.id, type: 'MAINTENANCE', title: 'Global maintenance', body: 'Back in one hour', startsAt: expect.any(String), endsAt: global.endsAt, blocksLogin: true },
        ]);
        expect(JSON.stringify(response.body)).not.toContain(tenantA.tenantId);

        // Served from the cached snapshot: a row written behind the console's back shows only after the cache is dropped.
        await db.owner.query(`UPDATE platform_announcements SET title = 'Changed in the database' WHERE id = $1`, [global.id]);
        expect((await http().get('/announcements/login').expect(200)).body[0].title).toBe('Global maintenance');
        app.get(LoginBlockRegistry).invalidate();
        expect((await http().get('/announcements/login').expect(200)).body[0].title).toBe('Changed in the database');
      });
    });
  });
});
