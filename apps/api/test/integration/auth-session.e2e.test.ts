import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { meResponseSchema } from '@procesabpm/shared';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../src/infrastructure/security/jwt-token-service.js';
import { sha256Hex } from '../../src/infrastructure/security/token-utils.js';
import { bearer, logIn, REFRESH_COOKIE_NAME, refreshCookieOf, refreshSetCookieOf, signIn } from '../support/auth-helpers.js';
import { addMembership, inviteUser, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('sessions', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const http = () => request(app.getHttpServer());
  const me = (accessToken: string) => http().get('/auth/me').set(bearer(accessToken));
  const refresh = (cookie: string) => http().post('/auth/refresh').set('cookie', cookie);
  const cookieValue = (cookie: string) => cookie.slice(REFRESH_COOKIE_NAME.length + 1);
  /** Moves the rotation of a session back in time, past the grace window for concurrent refreshes. */
  const rotatedAMinuteAgo = (cookie: string) =>
    db.platform.query(`UPDATE refresh_sessions SET revoked_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256Hex(cookieValue(cookie))]);

  async function sessionsOf(userId: string) {
    const { rows } = await db.platform.query<{ id: string; token_hash: string; revoked_at: Date | null; replaced_by: string | null; active_tenant_id: string }>(
      'SELECT id, token_hash, revoked_at, replaced_by, active_tenant_id FROM refresh_sessions WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return rows;
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([grantEverything(db, tenantA), grantEverything(db, tenantB)]);
    ({ app } = await createTestApp({ controllers: [TenantProbeController] }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('full flow: login → select-tenant → protected route → refresh → reuse → logout', () => {
    let user: TestUser;
    let first: { accessToken: string; refreshCookie: string; setCookie: string };
    let second: { accessToken: string; refreshCookie: string };

    beforeAll(async () => {
      user = await seedUser(db, tenantA);
    });

    it('select-tenant returns a 15-minute access token and sets the refresh cookie', async () => {
      const selectionToken = await logIn(app, user.email);
      const response = await http()
        .post('/auth/select-tenant')
        .set(bearer(selectionToken))
        .send({ tenantId: tenantA.tenantId })
        .expect(200);
      expect(response.body).toEqual({ accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 900 });
      expect(decodeJwt(response.body.accessToken)).toMatchObject({ sub: user.userId, tid: tenantA.tenantId, sid: expect.any(String) });

      const setCookie = refreshSetCookieOf(response)!;
      expect(setCookie).toMatch(/^__Secure-refresh_token=[A-Za-z0-9_-]{43};/);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/auth');
      const expires = Date.parse(/Expires=([^;]+)/.exec(setCookie)![1]!);
      expect((expires - Date.now()) / 86_400_000).toBeCloseTo(14, 0);
      first = { accessToken: response.body.accessToken, refreshCookie: refreshCookieOf(response)!, setCookie };
    });

    it('stores only the SHA-256 of the refresh token, with the active tenant', async () => {
      const [session] = await sessionsOf(user.userId);
      expect(session).toMatchObject({
        token_hash: sha256Hex(cookieValue(first.refreshCookie)),
        active_tenant_id: tenantA.tenantId,
        revoked_at: null,
      });
      expect(session!.id).toBe(decodeJwt(first.accessToken).sid);
    });

    it('the access token opens protected routes: GET /auth/me', async () => {
      const response = await me(first.accessToken).expect(200);
      const profile = meResponseSchema.parse(response.body);
      expect(profile.user).toMatchObject({ id: user.userId, email: user.email });
      expect(profile.membership).toMatchObject({ tenantId: tenantA.tenantId, status: 'ACTIVE', role: { isAdmin: true } });
      expect(profile.membership.companies).toEqual([expect.objectContaining({ id: tenantA.companyId, isDefault: true })]);
      expect(JSON.stringify(response.body)).not.toMatch(/password|mfaSecret|failedLogins|lockedUntil/i);
    });

    it('refresh rotates: new tokens, and the old session is marked as replaced', async () => {
      const response = await refresh(first.refreshCookie).expect(200);
      second = { accessToken: response.body.accessToken, refreshCookie: refreshCookieOf(response)! };
      expect(second.refreshCookie).not.toBe(first.refreshCookie);
      const [old, current] = await sessionsOf(user.userId);
      expect(old).toMatchObject({ revoked_at: expect.any(Date), replaced_by: current!.id });
      expect(current).toMatchObject({ revoked_at: null, replaced_by: null, active_tenant_id: tenantA.tenantId });
    });

    it('the access token of the rotated session stops working at once; the new one works', async () => {
      await me(first.accessToken).expect(401);
      await me(second.accessToken).expect(200);
    });

    it('the rotation keeps the absolute expiry of the session', async () => {
      const { rows } = await db.platform.query<{ expires_at: Date }>(
        'SELECT expires_at FROM refresh_sessions WHERE user_id = $1 ORDER BY created_at',
        [user.userId],
      );
      expect(rows[1]!.expires_at).toEqual(rows[0]!.expires_at);
    });

    it('reusing a rotated refresh token right after the rotation is refused without revoking anything (two tabs)', async () => {
      await refresh(first.refreshCookie).expect(401);
      await me(second.accessToken).expect(200);
    });

    it('reusing a rotated refresh token later revokes every session of the user (theft detection)', async () => {
      const elsewhere = await signIn(app, user.email, tenantA.tenantId);
      await rotatedAMinuteAgo(first.refreshCookie);
      const response = await refresh(first.refreshCookie).expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(refreshCookieOf(response)).toBeUndefined();

      for (const session of await sessionsOf(user.userId)) expect(session.revoked_at).not.toBeNull();
      await me(second.accessToken).expect(401);
      await me(elsewhere.accessToken).expect(401);
      await refresh(second.refreshCookie).expect(401);
    });

    it('logout revokes only the current session and clears the cookie', async () => {
      const kept = await signIn(app, user.email, tenantA.tenantId);
      const closed = await signIn(app, user.email, tenantA.tenantId);
      const response = await http().post('/auth/logout').set('cookie', closed.refreshCookie).expect(204);
      expect(refreshSetCookieOf(response)).toMatch(/^__Secure-refresh_token=;.*Expires=Thu, 01 Jan 1970/);

      await me(closed.accessToken).expect(401);
      await refresh(closed.refreshCookie).expect(401);
      await me(kept.accessToken).expect(200);
      await refresh(kept.refreshCookie).expect(200);
    });
  });

  describe('refresh', () => {
    it.each([
      ['without a cookie', undefined],
      ['with an unknown token', `${REFRESH_COOKIE_NAME}=${'A'.repeat(43)}`],
      ['with an empty cookie', `${REFRESH_COOKIE_NAME}=`],
      ['with the name without the __Secure- prefix', `refresh_token=${'A'.repeat(43)}`],
    ])('answers 401 %s', async (_label, cookie) => {
      const call = http().post('/auth/refresh');
      const response = await (cookie === undefined ? call : call.set('cookie', cookie)).expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('refuses two refresh cookies at once (cookie planted by another site), without revoking anything', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      const planted = `${REFRESH_COOKIE_NAME}=${'B'.repeat(43)}`;
      await refresh(`${planted}; ${session.refreshCookie}`).expect(401);
      await refresh(session.refreshCookie).expect(200);
    });

    it('of two concurrent refreshes with the same token, one rotates and the other is refused; nothing else is revoked', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      const responses = await Promise.all([refresh(session.refreshCookie), refresh(session.refreshCookie)]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
      const winner = responses.find((response) => response.status === 200)!;
      await me(winner.body.accessToken).expect(200);
      await refresh(refreshCookieOf(winner)!).expect(200);
    });

    it('a refresh racing a logout never revokes the other sessions', async () => {
      const user = await seedUser(db, tenantA);
      const other = await signIn(app, user.email, tenantA.tenantId);
      const session = await signIn(app, user.email, tenantA.tenantId);
      await Promise.all([refresh(session.refreshCookie), http().post('/auth/logout').set('cookie', session.refreshCookie)]);
      await me(other.accessToken).expect(200);
    });

    it('a suspended tenant refuses the refresh with 403 and keeps the cookie and the session', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenant.tenantId]);
      const response = await refresh(session.refreshCookie).expect(403);
      expect(refreshSetCookieOf(response)).toBeUndefined();
      await db.platform.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [tenant.tenantId]);
      await refresh(session.refreshCookie).expect(200);
    });

    it('rejects an expired session', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      await db.platform.query(`UPDATE refresh_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [user.userId]);
      await refresh(session.refreshCookie).expect(401);
      await me(session.accessToken).expect(401);
    });

    it('rejects a session whose membership became inactive', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenantA.tenantId, user.userId]);
      await refresh(session.refreshCookie).expect(401);
    });

    it('a revoked session cannot refresh, and that is not treated as theft', async () => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      await db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1', [user.userId]);
      await refresh(session.refreshCookie).expect(401);
      // A plain revocation is not a reuse: the user's other sessions are not touched by it.
      const fresh = await signIn(app, user.email, tenantA.tenantId);
      await refresh(session.refreshCookie).expect(401);
      await me(fresh.accessToken).expect(200);
    });
  });

  describe('select-tenant', () => {
    let user: TestUser;
    let selectionToken: string;

    beforeAll(async () => {
      user = await seedUser(db, tenantA);
      selectionToken = await logIn(app, user.email);
    });

    const select = (token: string | undefined, tenantId: string) => {
      const call = http().post('/auth/select-tenant').send({ tenantId });
      return token === undefined ? call : call.set(bearer(token));
    };

    it('needs the selection token', async () => {
      await select(undefined, tenantA.tenantId).expect(401);
      await select('garbage', tenantA.tenantId).expect(401);
    });

    it('refuses a tenant where the user has no membership', async () => {
      const response = await select(selectionToken, tenantB.tenantId).expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('refuses a tenant where the membership is only INVITED', async () => {
      const invited = await inviteUser(db, tenantB, user.email);
      expect(invited.userId).toBe(user.userId);
      await select(selectionToken, tenantB.tenantId).expect(401);
    });

    it('refuses an access token in place of the selection token', async () => {
      const { accessToken } = await signIn(app, user.email, tenantA.tenantId);
      await select(accessToken, tenantA.tenantId).expect(401);
    });

    it('a selection token is not an access token', async () => {
      await me(selectionToken).expect(401);
    });

    it.each(['acme', '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff'])(
      'validates the tenant id %j',
      async (tenantId) => {
        const response = await select(selectionToken, tenantId).expect(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('access token guard', () => {
    it('rejects a token whose membership became INACTIVE, even though the token is valid', async () => {
      const user = await seedUser(db, tenantA);
      const { accessToken } = await signIn(app, user.email, tenantA.tenantId);
      await me(accessToken).expect(200);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenantA.tenantId, user.userId]);
      const response = await me(accessToken).expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it.each(['DISABLED', 'LOCKED'])('rejects a user whose account became %s, also on refresh', async (status) => {
      const user = await seedUser(db, tenantA);
      const session = await signIn(app, user.email, tenantA.tenantId);
      await db.platform.query('UPDATE users SET status = $1::user_status WHERE id = $2', [status, user.userId]);
      await me(session.accessToken).expect(401);
      await refresh(session.refreshCookie).expect(401);
    });

    it('answers 403 TENANT_SUSPENDED while the tenant is suspended', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const { accessToken } = await signIn(app, user.email, tenant.tenantId);
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenant.tenantId]);
      const response = await me(accessToken).expect(403);
      expect(response.body.error.code).toBe('TENANT_SUSPENDED');
      await db.platform.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [tenant.tenantId]);
      await me(accessToken).expect(200);
    });

    it.each([
      ['no header', undefined],
      ['another scheme', 'Basic abc'],
      ['a malformed token', 'Bearer abc.def.ghi'],
    ])('rejects %s', async (_label, header) => {
      const call = http().get('/auth/me');
      await (header === undefined ? call : call.set('authorization', header)).expect(401);
    });
  });

  describe('tenant isolation over HTTP (tenant leak test)', () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await seedUser(db, tenantA);
      await addMembership(db, tenantB, user.userId);
    });

    it('a member of two tenants only reaches the tenant of the token', async () => {
      const inA = await signIn(app, user.email, tenantA.tenantId);
      const inB = await signIn(app, user.email, tenantB.tenantId);
      const [a, b] = await Promise.all([
        http().get('/test/companies').set(bearer(inA.accessToken)).expect(200),
        http().get('/test/companies').set(bearer(inB.accessToken)).expect(200),
      ]);
      expect(a.body.map((company: { tenantId: string }) => company.tenantId)).toEqual([tenantA.tenantId]);
      expect(b.body.map((company: { tenantId: string }) => company.tenantId)).toEqual([tenantB.tenantId]);
    });

    it('a token whose tenant claim was changed is rejected', async () => {
      const { accessToken } = await signIn(app, user.email, tenantA.tenantId);
      const [header, payload, signature] = accessToken.split('.');
      const claims = { ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), tid: tenantB.tenantId };
      const forged = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
      await http().get('/test/companies').set(bearer(forged)).expect(401);
    });

    it('a session opened on one tenant cannot be used for another (sid bound to tid)', async () => {
      const inA = await signIn(app, user.email, tenantA.tenantId);
      const inB = await signIn(app, user.email, tenantB.tenantId);
      const tokens = app.get(JwtTokenService);
      const mixed = await tokens.issueAccessToken({ sub: user.userId, tid: tenantB.tenantId, sid: decodeJwt(inA.accessToken).sid as string });
      await http().get('/test/companies').set(bearer(mixed.token)).expect(401);
      await http().get('/test/companies').set(bearer(inB.accessToken)).expect(200);
    });
  });
});
