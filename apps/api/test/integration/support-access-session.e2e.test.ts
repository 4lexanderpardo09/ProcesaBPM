import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { grantSupport, openSupportSession, revokeSupport, verifiedAdminOf } from '../support/support-fixtures.js';
import { TEST_JWT_SECRET, useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('a platform administrator reads a tenant that granted support access', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let platformToken: string;
  let platformUserId: string;
  const http = () => request(app.getHttpServer());

  /** A tenant whose administrator has granted support access; returns what the tests need. */
  async function grantedTenant(options: { hours?: number } = {}) {
    const tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    const admin = await verifiedAdminOf(app, db, tenant);
    const grant = (await grantSupport(app, admin.accessToken, { hours: options.hours ?? 2, reason: 'Investigating a stuck ticket' }).expect(201)).body;
    return { tenant, admin, grant };
  }
  const visit = async (tenant: SeededTenant) => (await openSupportSession(app, platformToken, tenant.tenantId).expect(201)).body as { accessToken: string; expiresIn: number; sessionId: string; grantId: string; grantExpiresAt: string };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    const admin = await seedPlatformAdmin(db);
    platformUserId = admin.userId;
    platformToken = await signInPlatform(app, db, admin);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('opening a visit', () => {
    it('is refused with 403 SUPPORT_ACCESS_NOT_GRANTED when the tenant has not granted access', async () => {
      const tenant = await seedTenant(db.platform);
      const response = await openSupportSession(app, platformToken, tenant.tenantId).expect(403);
      expect(response.body.error.code).toBe('SUPPORT_ACCESS_NOT_GRANTED');
    });

    it('answers 404 for an unknown tenant and 400 for a malformed id', async () => {
      await openSupportSession(app, platformToken, '018f3c1e-7b2a-7c3d-9e4f-0123456789ab').expect(404);
      await openSupportSession(app, platformToken, 'nope').expect(400);
    });

    it('gives a token that lasts 15 minutes at most, and never past the end of the grant', async () => {
      const { tenant, grant } = await grantedTenant({ hours: 2 });
      const long = await visit(tenant);
      expect(long.expiresIn).toBe(900);
      expect(long.grantId).toBe(grant.id);

      const shortLived = await seedTenant(db.platform);
      await grantEverything(db, shortLived);
      const admin = await verifiedAdminOf(app, db, shortLived);
      await grantSupport(app, admin.accessToken, { hours: 1, reason: 'Short grant' }).expect(201);
      await db.owner.query(`UPDATE support_access_grants SET starts_at = now() - interval '59 minutes 30 seconds', expires_at = now() + interval '30 seconds' WHERE tenant_id = $1`, [shortLived.tenantId]);
      const near = await visit(shortLived);
      expect(near.expiresIn).toBeLessThanOrEqual(30);
      expect(near.expiresIn).toBeGreaterThan(0);
    });

    it('records the opening in the platform audit log', async () => {
      const { tenant, grant } = await grantedTenant();
      const { sessionId } = await visit(tenant);
      const { rows } = await db.owner.query(`SELECT actor_user_id, data FROM platform_audit_logs WHERE action = 'support_session.opened' AND target_tenant_id = $1`, [tenant.tenantId]);
      expect(rows).toEqual([{ actor_user_id: platformUserId, data: expect.objectContaining({ grantId: grant.id, sessionId }) }]);
    });

    it('the grant of one tenant opens nothing in another', async () => {
      const { tenant } = await grantedTenant();
      const other = await seedTenant(db.platform);
      await openSupportSession(app, platformToken, other.tenantId).expect(403);
      const { accessToken } = await visit(tenant);
      // The token is bound to its tenant: it reads that tenant's companies and nobody else's.
      const companies = await http().get('/companies').set(bearer(accessToken)).expect(200);
      const ids = companies.body.items.map((company: { id: string }) => company.id);
      expect(ids).toContain(tenant.companyId);
      expect(ids).not.toContain(other.companyId);
    });

    it('a tenant member, even an administrator, cannot open one: it is a platform route', async () => {
      const { tenant, admin } = await grantedTenant();
      await openSupportSession(app, admin.accessToken, tenant.tenantId).expect(403);
      await http().post(`/platform/tenants/${tenant.tenantId}/support-sessions`).expect(401);
    });
  });

  describe('what the visit can do', () => {
    it('reads the tenant configuration', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      for (const path of ['/companies', '/departments', '/workflows', '/calendars']) await http().get(path).set(bearer(accessToken)).expect(200);
    });

    it.each([
      ['POST', '/companies'],
      ['PATCH', '/companies/018f3c1e-7b2a-7c3d-9e4f-0123456789ab'],
      ['PUT', '/settings/security'],
      ['DELETE', '/settings/support-access'],
      ['POST', '/settings/support-access'],
      ['POST', '/auth/password'],
      ['POST', '/notifications/read-all'],
    ])('refuses %s %s with 403 SUPPORT_ACCESS_READ_ONLY and changes nothing', async (method, path) => {
      const { tenant, admin } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      const before = (await http().get('/settings/support-access').set(bearer(admin.accessToken)).expect(200)).body.active.id;
      const response = await http()[method.toLowerCase() as 'post'](path).set(bearer(accessToken)).send({ name: 'x', reason: 'sneaky', hours: 72 });
      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(response.body.error.code).toBe('SUPPORT_ACCESS_READ_ONLY');
      expect((await http().get('/settings/support-access').set(bearer(admin.accessToken)).expect(200)).body.active.id).toBe(before);
    });

    it('does not read what the template hides: the tenant audit log, security and support settings', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().get('/audit-logs').set(bearer(accessToken)).expect(403);
      await http().get('/settings/security').set(bearer(accessToken)).expect(403);
      await http().get('/settings/support-access').set(bearer(accessToken)).expect(403);
    });

    it('never opens the platform area, whatever the route', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().get('/platform/tenants').set(bearer(accessToken)).expect(403);
      await http().get('/platform/admins').set(bearer(accessToken)).expect(403);
      await openSupportSession(app, accessToken, tenant.tenantId).expect(403);
    });
  });

  describe('when the door closes', () => {
    it('revoking the grant ends the visit at the next request (401) and closes it', async () => {
      const { tenant, admin } = await grantedTenant();
      const { accessToken, sessionId } = await visit(tenant);
      await http().get('/companies').set(bearer(accessToken)).expect(200);
      await revokeSupport(app, admin.accessToken).expect(204);
      await http().get('/companies').set(bearer(accessToken)).expect(401);
      const { rows } = await db.owner.query('SELECT closed_at FROM support_sessions WHERE id = $1', [sessionId]);
      expect(rows[0].closed_at).not.toBeNull();
      await openSupportSession(app, platformToken, tenant.tenantId).expect(403);
    });

    it('an expired grant ends the visit (401) and cannot be renewed (403)', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await db.owner.query(`UPDATE support_access_grants SET starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE tenant_id = $1`, [tenant.tenantId]);
      await http().get('/companies').set(bearer(accessToken)).expect(401);
      await openSupportSession(app, platformToken, tenant.tenantId).expect(403);
    });

    it('a renewed token works while the grant lasts', async () => {
      const { tenant } = await grantedTenant();
      const first = await visit(tenant);
      const second = await visit(tenant);
      expect(second.sessionId).not.toBe(first.sessionId);
      await http().get('/companies').set(bearer(second.accessToken)).expect(200);
    });

    it('closing the visit from the platform ends it at once and is audited', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken, sessionId } = await visit(tenant);
      await http().delete(`/platform/tenants/${tenant.tenantId}/support-sessions/${sessionId}`).set(bearer(platformToken)).expect(204);
      await http().get('/companies').set(bearer(accessToken)).expect(401);
      await http().delete(`/platform/tenants/${tenant.tenantId}/support-sessions/${sessionId}`).set(bearer(platformToken)).expect(404);
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE action = 'support_session.closed' AND data ->> 'sessionId' = $1`, [sessionId])).rowCount).toBe(1);
    });

    it('ending the platform session ends the visit at once (a platform logout, within the 15 minutes of the token)', async () => {
      const { tenant } = await grantedTenant();
      const temporary = await seedPlatformAdmin(db);
      const token = await signInPlatform(app, db, temporary);
      const { accessToken } = (await openSupportSession(app, token, tenant.tenantId).expect(201)).body;
      await http().get('/companies').set(bearer(accessToken)).expect(200);
      await http().post('/auth/platform/logout').set(bearer(token)).expect(204);
      await http().get('/companies').set(bearer(accessToken)).expect(401);
    });

    it('removing the platform administrator ends the visit', async () => {
      const { tenant } = await grantedTenant();
      const temporary = await seedPlatformAdmin(db);
      const token = await signInPlatform(app, db, temporary);
      const { accessToken } = (await openSupportSession(app, token, tenant.tenantId).expect(201)).body;
      await http().get('/companies').set(bearer(accessToken)).expect(200);
      await db.owner.query('DELETE FROM platform_admins WHERE user_id = $1', [temporary.userId]);
      await http().get('/companies').set(bearer(accessToken)).expect(401);
    });
  });

  describe('tokens', () => {
    const forge = (audience: string, claims: Record<string, string>, secret = TEST_JWT_SECRET) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub!)
        .setIssuer('procesabpm')
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(secret));

    it('a forged support token (wrong signature) is refused, even with real ids', async () => {
      const { tenant } = await grantedTenant();
      const real = await visit(tenant);
      const forged = await forge('procesabpm:support', { sub: platformUserId, tid: tenant.tenantId, sid: real.sessionId, grant: real.grantId }, 'another-secret-with-more-than-32-bytes!!');
      await http().get('/companies').set(bearer(forged)).expect(401);
    });

    it('a support token signed with the right key but ids that match no visit is refused', async () => {
      const { tenant, grant } = await grantedTenant();
      const forged = await forge('procesabpm:support', { sub: platformUserId, tid: tenant.tenantId, sid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab', grant: grant.id });
      await http().get('/companies').set(bearer(forged)).expect(401);
    });

    it('a `support` claim on an ordinary access token changes nothing: the audience decides', async () => {
      const { tenant, admin } = await grantedTenant();
      const real = await visit(tenant);
      const payload = JSON.parse(Buffer.from(admin.accessToken.split('.')[1]!, 'base64url').toString()) as { sub: string; tid: string; sid: string };
      const smuggled = await forge('procesabpm:api', { sub: payload.sub, tid: payload.tid, sid: payload.sid, support: real.grantId });
      const response = await http().get('/audit-logs').set(bearer(smuggled));
      // It is the member's own session (admin role): it never became a support session.
      expect(response.status).toBe(200);
      await http().post('/companies').set(bearer(smuggled)).send({ name: 'Made by the member', countryCode: 'CO' }).expect(201);
    });

    it('a support token is not an access token for the member routes that need a member, nor a platform token', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().get('/auth/me').set(bearer(accessToken)).expect(401);
      await http().post('/auth/platform/logout').set(bearer(accessToken)).expect(403);
    });

    it('an ordinary access token and a platform token never work as support tokens', async () => {
      const { tenant, admin } = await grantedTenant();
      const member = await signIn(app, (await seedUser(db, tenant)).email, tenant.tenantId);
      // They keep their own meaning, and the support guard did not take them for visits.
      await http().get('/companies').set(bearer(admin.accessToken)).expect(200);
      await http().get('/companies').set(bearer(member.accessToken)).expect(200);
      await http().get('/companies').set(bearer(platformToken)).expect(401);
    });
  });

  describe('audit of what the visit does', () => {
    it('records what the guards refuse too: write attempts and subjects support cannot read (DENIED)', async () => {
      const { tenant, grant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().post('/companies').set(bearer(accessToken)).send({ name: 'x', countryCode: 'CO' }).expect(403);
      await http().delete('/settings/support-access').set(bearer(accessToken)).expect(403);
      await http().get('/audit-logs').set(bearer(accessToken)).expect(403);

      const { rows } = await db.owner.query(`SELECT support_grant_id, after FROM audit_logs WHERE tenant_id = $1 AND action = 'support.request' ORDER BY created_at`, [tenant.tenantId]);
      expect(rows.map((row) => row.support_grant_id)).toEqual([grant.id, grant.id, grant.id]);
      expect(rows.map((row) => row.after)).toEqual([
        expect.objectContaining({ method: 'POST', route: '/companies', outcome: 'DENIED', status: 403, code: 'SUPPORT_ACCESS_READ_ONLY' }),
        expect.objectContaining({ method: 'DELETE', route: '/settings/support-access', outcome: 'DENIED', status: 403, code: 'SUPPORT_ACCESS_READ_ONLY' }),
        expect.objectContaining({ method: 'GET', route: '/audit-logs', outcome: 'DENIED', status: 403, code: 'PERMISSION_DENIED' }),
      ]);
    });

    it('a write attempt with a dead visit is a plain 401 and leaves no row', async () => {
      const { tenant, admin } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await revokeSupport(app, admin.accessToken).expect(204);
      await http().post('/companies').set(bearer(accessToken)).send({ name: 'x', countryCode: 'CO' }).expect(401);
      const { rowCount } = await db.owner.query(`SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'support.request'`, [tenant.tenantId]);
      expect(rowCount).toBe(0);
    });

    it('records every request in the tenant audit log with the administrator and the grant, never the query string', async () => {
      const { tenant, admin, grant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().get('/companies?search=secret-term').set(bearer(accessToken)).expect(200);
      await http().get(`/companies/${tenant.companyId}`).set(bearer(accessToken)).expect(200);
      await http().get('/companies/018f3c1e-7b2a-7c3d-9e4f-0123456789ab').set(bearer(accessToken)).expect(404);

      const { rows } = await db.owner.query(
        `SELECT actor_id, support_actor_id, support_grant_id, entity_id, after FROM audit_logs WHERE tenant_id = $1 AND action = 'support.request' ORDER BY created_at`,
        [tenant.tenantId],
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.actor_id === null && row.support_actor_id === platformUserId && row.support_grant_id === grant.id)).toBe(true);
      expect(rows.map((row) => row.after)).toEqual([
        { ids: [], method: 'GET', route: '/companies', outcome: 'OK', status: 200 },
        { ids: [tenant.companyId], method: 'GET', route: '/companies/:id', outcome: 'OK', status: 200 },
        expect.objectContaining({ method: 'GET', route: '/companies/:id', outcome: 'ERROR', status: 404 }),
      ]);
      expect(rows[1].entity_id).toBe(tenant.companyId);
      expect(JSON.stringify(rows)).not.toContain('secret-term');

      // The tenant administrator sees the visit, the count and the entries.
      const state = (await http().get('/settings/support-access').set(bearer(admin.accessToken)).expect(200)).body;
      expect(state.active.requests).toBe(3);
      expect(state.active.visits).toEqual([expect.objectContaining({ administrator: expect.any(String), closedAt: null })]);
      const trail = (await http().get('/audit-logs?action=support.request').set(bearer(admin.accessToken)).expect(200)).body.items;
      expect(trail).toHaveLength(3);
      expect(trail[0]).toMatchObject({ actor: null, supportGrantId: grant.id });
    });

    it('rows written by a visit during an admin-style read (file downloads) carry the administrator too', async () => {
      const { tenant } = await grantedTenant();
      const { accessToken } = await visit(tenant);
      await http().get('/files/018f3c1e-7b2a-7c3d-9e4f-0123456789ab/download-url').set(bearer(accessToken));
      const { rows } = await db.owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND support_grant_id IS NOT NULL AND actor_id IS NOT NULL`, [tenant.tenantId]);
      expect(rows[0].n).toBe(0);
    });
  });
});
