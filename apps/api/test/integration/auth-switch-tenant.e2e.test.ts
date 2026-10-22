import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../src/infrastructure/security/jwt-token-service.js';
import { sha256Hex } from '../../src/infrastructure/security/token-utils.js';
import { bearer, REFRESH_COOKIE_NAME, refreshCookieOf, refreshSetCookieOf, type SignedIn, signIn } from '../support/auth-helpers.js';
import { addMembership, inviteUser, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('POST /auth/switch-tenant', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let home: SeededTenant;
  let other: SeededTenant;

  const http = () => request(app.getHttpServer());
  const me = (accessToken: string) => http().get('/auth/me').set(bearer(accessToken));
  const refresh = (cookie: string) => http().post('/auth/refresh').set('cookie', cookie);
  const switchTenant = (cookie: string | undefined, tenantId: string) => {
    const call = http().post('/auth/switch-tenant');
    return (cookie === undefined ? call : call.set('cookie', cookie)).send({ tenantId });
  };
  const cookieValue = (cookie: string) => cookie.slice(REFRESH_COOKIE_NAME.length + 1);
  const rotatedAMinuteAgo = (cookie: string) =>
    db.platform.query(`UPDATE refresh_sessions SET revoked_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256Hex(cookieValue(cookie))]);

  async function sessionOf(cookie: string) {
    const { rows } = await db.platform.query<{ id: string; active_tenant_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null; mfa_verified: boolean }>(
      'SELECT id, active_tenant_id, expires_at, revoked_at, replaced_by, mfa_verified FROM refresh_sessions WHERE token_hash = $1',
      [sha256Hex(cookieValue(cookie))],
    );
    return rows[0]!;
  }

  /** A member of `home` who also belongs to `other`, signed in to `home`. */
  async function memberOfBoth(): Promise<{ user: TestUser; session: SignedIn }> {
    const user = await seedUser(db, home);
    await addMembership(db, other, user.userId);
    return { user, session: await signIn(app, user.email, home.tenantId) };
  }

  /** The current session is untouched: its access token and its cookie still work. */
  async function expectStillSignedIn(session: SignedIn): Promise<void> {
    const profile = await me(session.accessToken).expect(200);
    expect(profile.body.membership.tenantId).toBe(home.tenantId);
    await refresh(session.refreshCookie).expect(200);
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    [home, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([grantEverything(db, home), grantEverything(db, other)]);
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('GET /auth/me/organizations lists the organizations of the signed-in user, the current one among them', async () => {
    const { session } = await memberOfBoth();
    const response = await http().get('/auth/me/organizations').set(bearer(session.accessToken)).expect(200);
    const ids = (response.body.organizations as Array<{ tenantId: string; membershipStatus: string; tenantStatus: string }>).map((organization) => organization.tenantId);
    expect(ids.sort()).toEqual([home.tenantId, other.tenantId].sort());
    await http().get('/auth/me/organizations').expect(401);
  });

  describe('a member of both organizations', () => {
    let user: TestUser;
    let before: SignedIn;
    let after: SignedIn;
    let switched: request.Response;

    beforeAll(async () => {
      ({ user, session: before } = await memberOfBoth());
      switched = await switchTenant(before.refreshCookie, other.tenantId).expect(200);
      after = { accessToken: switched.body.accessToken, refreshCookie: refreshCookieOf(switched)! };
    });

    it('gets an access token for the target tenant and a new refresh cookie', async () => {
      expect(switched.body).toEqual({ accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 900 });
      expect(decodeJwt(after.accessToken)).toMatchObject({ sub: user.userId, tid: other.tenantId });
      expect(after.refreshCookie).not.toBe(before.refreshCookie);
      const setCookie = refreshSetCookieOf(switched)!;
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/api/auth');
      const profile = await me(after.accessToken).expect(200);
      expect(profile.body.membership.tenantId).toBe(other.tenantId);
      expect(profile.body.organization.id).toBe(other.tenantId);
    });

    it('replaces the old session and keeps its absolute expiry', async () => {
      const [old, current] = [await sessionOf(before.refreshCookie), await sessionOf(after.refreshCookie)];
      expect(old).toMatchObject({ revoked_at: expect.any(Date), replaced_by: current.id, active_tenant_id: home.tenantId });
      expect(current).toMatchObject({ revoked_at: null, replaced_by: null, active_tenant_id: other.tenantId, mfa_verified: false });
      expect(current.expires_at).toEqual(old.expires_at);
      expect(decodeJwt(after.accessToken).sid).toBe(current.id);
      const expires = Date.parse(/Expires=([^;]+)/.exec(refreshSetCookieOf(switched)!)![1]!);
      expect(Math.abs(expires - current.expires_at.getTime())).toBeLessThan(1_000);
    });

    it('the old access token stops working at once; the old cookie is refused without clearing the new one', async () => {
      await me(before.accessToken).expect(401);
      const reused = await refresh(before.refreshCookie).expect(401);
      expect(refreshSetCookieOf(reused)).toBeUndefined();
      await switchTenant(before.refreshCookie, home.tenantId).expect(401);
      await me(after.accessToken).expect(200);
    });

    it('the new cookie refreshes within the target tenant and can switch back', async () => {
      const refreshed = await refresh(after.refreshCookie).expect(200);
      expect(decodeJwt(refreshed.body.accessToken).tid).toBe(other.tenantId);
      const back = await switchTenant(refreshCookieOf(refreshed)!, home.tenantId).expect(200);
      expect(decodeJwt(back.body.accessToken).tid).toBe(home.tenantId);
      await me(back.body.accessToken).expect(200);
    });
  });

  it('the current tenant as target is a plain rotation', async () => {
    const { session } = await memberOfBoth();
    const response = await switchTenant(session.refreshCookie, home.tenantId).expect(200);
    expect(decodeJwt(response.body.accessToken).tid).toBe(home.tenantId);
    await me(session.accessToken).expect(401);
    await me(response.body.accessToken).expect(200);
  });

  describe('refused: the current session stays as it was', () => {
    it.each([
      ['without a membership in the target', async (_user: TestUser) => (await seedTenant(db.platform)).tenantId],
      ['to an organization that does not exist', async () => '01900000-0000-7000-8000-000000000000'],
      ['with an INVITED membership in the target', async (user: TestUser) => {
        const tenant = await seedTenant(db.platform);
        const { userId } = await inviteUser(db, tenant, user.email);
        expect(userId).toBe(user.userId);
        return tenant.tenantId;
      }],
      ['with an INACTIVE membership in the target', async (user: TestUser) => {
        await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [other.tenantId, user.userId]);
        return other.tenantId;
      }],
    ])('403 ORGANIZATION_UNAVAILABLE %s', async (_label, targetOf) => {
      const { user, session } = await memberOfBoth();
      const target = await targetOf(user);
      const response = await switchTenant(session.refreshCookie, target).expect(403);
      expect(response.body.error.code).toBe('ORGANIZATION_UNAVAILABLE');
      expect(refreshSetCookieOf(response)).toBeUndefined();
      await expectStillSignedIn(session);
    });

    it('403 TENANT_SUSPENDED to a suspended organization', async () => {
      const tenant = await seedTenant(db.platform);
      const { user, session } = await memberOfBoth();
      await addMembership(db, tenant, user.userId);
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenant.tenantId]);
      const response = await switchTenant(session.refreshCookie, tenant.tenantId).expect(403);
      expect(response.body.error.code).toBe('TENANT_SUSPENDED');
      expect(refreshSetCookieOf(response)).toBeUndefined();
      await expectStillSignedIn(session);
    });

    it('403 MFA_REQUIRED to an organization that requires the second factor, from a session that did not pass it', async () => {
      const tenant = await seedTenant(db.platform);
      const { user, session } = await memberOfBoth();
      await addMembership(db, tenant, user.userId);
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]);
      const response = await switchTenant(session.refreshCookie, tenant.tenantId).expect(403);
      expect(response.body.error.code).toBe('MFA_REQUIRED');
      expect(refreshSetCookieOf(response)).toBeUndefined();
      await expectStillSignedIn(session);
    });

    it('400 for a malformed body, without touching the session', async () => {
      const { session } = await memberOfBoth();
      await http().post('/auth/switch-tenant').set('cookie', session.refreshCookie).send({ tenantId: 'nope' }).expect(400);
      await expectStillSignedIn(session);
    });
  });

  it('a session that passed the second factor carries it into an organization that requires it', async () => {
    const tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    const user = await seedUser(db, home);
    await addMembership(db, tenant, user.userId);
    await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]);
    const selection = await app.get(JwtTokenService).issueSelectionToken(user.userId, { mfa: true });
    const opened = await http().post('/auth/select-tenant').set(bearer(selection.token)).send({ tenantId: home.tenantId }).expect(200);

    const response = await switchTenant(refreshCookieOf(opened)!, tenant.tenantId).expect(200);
    await me(response.body.accessToken).expect(200);
    expect(await sessionOf(refreshCookieOf(response)!)).toMatchObject({ active_tenant_id: tenant.tenantId, mfa_verified: true });
  });

  describe('without a live session', () => {
    it.each([
      ['without a cookie', undefined],
      ['with an unknown token', `${REFRESH_COOKIE_NAME}=${'A'.repeat(43)}`],
    ])('401 %s', async (_label, cookie) => {
      const response = await switchTenant(cookie, home.tenantId).expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('401 and the cookie is cleared for a logged-out session', async () => {
      const { session } = await memberOfBoth();
      await http().post('/auth/logout').set('cookie', session.refreshCookie).expect(204);
      const response = await switchTenant(session.refreshCookie, other.tenantId).expect(401);
      expect(refreshSetCookieOf(response)).toMatch(/^__Secure-refresh_token=;/);
    });

    it('the old cookie presented later, once the switched session was used, revokes every session (theft detection)', async () => {
      const { user, session } = await memberOfBoth();
      const elsewhere = await signIn(app, user.email, home.tenantId);
      const switched = await switchTenant(session.refreshCookie, other.tenantId).expect(200);
      // The replacement was used: two holders of one session.
      const used = await refresh(refreshCookieOf(switched)!).expect(200);
      await rotatedAMinuteAgo(session.refreshCookie);

      const response = await switchTenant(session.refreshCookie, other.tenantId).expect(401);
      expect(refreshSetCookieOf(response)).toMatch(/^__Secure-refresh_token=;/);
      await me(used.body.accessToken).expect(401);
      await me(elsewhere.accessToken).expect(401);
    });

    it('the old cookie presented later, while the switched session was never used, revokes only that session (lost answer)', async () => {
      const { user, session } = await memberOfBoth();
      const elsewhere = await signIn(app, user.email, home.tenantId);
      const lost = await switchTenant(session.refreshCookie, other.tenantId).expect(200);
      await rotatedAMinuteAgo(session.refreshCookie);

      await switchTenant(session.refreshCookie, other.tenantId).expect(401);
      await me(lost.body.accessToken).expect(401);
      await me(elsewhere.accessToken).expect(200);
    });

    it('of two concurrent switches with the same cookie, one wins and the other is refused without revoking anything', async () => {
      const { session } = await memberOfBoth();
      const responses = await Promise.all([switchTenant(session.refreshCookie, other.tenantId), switchTenant(session.refreshCookie, home.tenantId)]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
      const winner = responses.find((response) => response.status === 200)!;
      expect(refreshSetCookieOf(responses.find((response) => response.status === 401)!)).toBeUndefined();
      await me(winner.body.accessToken).expect(200);
      await refresh(refreshCookieOf(winner)!).expect(200);
    });
  });

  it('a platform session (no tenant) cannot switch, even if its token were known', async () => {
    // Platform sessions never hand out their refresh token and support visits use their own token: this is the backstop.
    const user = await seedUser(db, home);
    const token = 'P'.repeat(43);
    await db.platform.query(
      `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at, mfa_verified) VALUES ($1, NULL, $2, now() + interval '15 minutes', true)`,
      [user.userId, sha256Hex(token)],
    );
    const response = await switchTenant(`${REFRESH_COOKIE_NAME}=${token}`, home.tenantId).expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ignores an access token: only the refresh cookie authenticates the switch', async () => {
    const { session } = await memberOfBoth();
    await http().post('/auth/switch-tenant').set(bearer(session.accessToken)).send({ tenantId: other.tenantId }).expect(401);
    await expectStillSignedIn(session);
  });
});
