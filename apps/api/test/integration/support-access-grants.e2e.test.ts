import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything, seedRole } from '../support/permission-fixtures.js';
import { grantSupport, revokeSupport, verifiedAdminOf } from '../support/support-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('the tenant grants support access', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  let adminToken: string;
  const http = () => request(app.getHttpServer());
  const state = (token = adminToken) => http().get('/settings/support-access').set(bearer(token));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    adminToken = (await verifiedAdminOf(app, db, tenant)).accessToken;
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('opens the door for 24 hours by default and shows it as the active grant', async () => {
    const created = await grantSupport(app, adminToken).expect(201);
    expect(created.body).toMatchObject({ status: 'ACTIVE', reason: 'Investigating a stuck ticket', visits: [], requests: 0 });
    const hours = (Date.parse(created.body.expiresAt) - Date.parse(created.body.startsAt)) / 3_600_000;
    expect(hours).toBeCloseTo(24, 1);

    const current = (await state().expect(200)).body;
    expect(current.active.id).toBe(created.body.id);
    expect(current.history[0].id).toBe(created.body.id);
  });

  it('a new grant replaces the one in force: the old one is revoked by the system in the same step', async () => {
    const first = (await grantSupport(app, adminToken, { hours: 2, reason: 'First reason' }).expect(201)).body;
    const second = (await grantSupport(app, adminToken, { hours: 48, reason: 'Second reason' }).expect(201)).body;
    const current = (await state().expect(200)).body;
    expect(current.active.id).toBe(second.id);
    const old = current.history.find((grant: { id: string }) => grant.id === first.id);
    expect(old).toMatchObject({ status: 'REVOKED', revokedBy: null });
    expect(old.revokedAt).not.toBeNull();
  });

  it('can be revoked by the tenant; revoking again finds nothing', async () => {
    await grantSupport(app, adminToken).expect(201);
    await revokeSupport(app, adminToken).expect(204);
    const current = (await state().expect(200)).body;
    expect(current.active).toBeNull();
    expect(current.history[0]).toMatchObject({ status: 'REVOKED', revokedBy: { name: expect.any(String) } });
    await revokeSupport(app, adminToken).expect(404);
  });

  it('is audited in the tenant audit log, with the reason', async () => {
    const created = (await grantSupport(app, adminToken, { hours: 3, reason: 'Audit me' }).expect(201)).body;
    await revokeSupport(app, adminToken).expect(204);
    const { rows } = await db.owner.query(`SELECT action, after FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at`, [tenant.tenantId, created.id]);
    expect(rows.map((row) => row.action)).toEqual(['support_access.granted', 'support_access.revoked']);
    expect(rows[0].after).toMatchObject({ hours: 3, reason: 'Audit me' });
    expect(rows[1].after).toEqual({ grants: [created.id] });
  });

  it('refuses hours out of range, a missing reason and extra time beyond 72 hours', async () => {
    await grantSupport(app, adminToken, { hours: 0, reason: 'Too short' }).expect(400);
    await grantSupport(app, adminToken, { hours: 73, reason: 'Too long' }).expect(400);
    await grantSupport(app, adminToken, { hours: 1.5, reason: 'Fraction' }).expect(400);
    await grantSupport(app, adminToken, { hours: 2 }).expect(400);
    await grantSupport(app, adminToken, { hours: 2, reason: 'x' }).expect(400);
    await grantSupport(app, adminToken, { hours: 72, reason: 'Exactly three days' }).expect(201);
  });

  it('needs a session that passed the second factor, to open and to close', async () => {
    const plain = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, plain.email, tenant.tenantId);
    expect((await grantSupport(app, accessToken).expect(422)).body.error.code).toBe('MFA_NOT_VERIFIED');
    await revokeSupport(app, accessToken).expect(422);
  });

  it('needs the SupportAccess permission: a member with another role is refused everywhere', async () => {
    const roleId = await seedRole(db, tenant.tenantId, 'No support');
    const limited = await seedUser(db, tenant, undefined, { roleId });
    const { accessToken } = await signIn(app, limited.email, tenant.tenantId);
    await state(accessToken).expect(403);
    await grantSupport(app, accessToken).expect(403);
    await revokeSupport(app, accessToken).expect(403);
    await http().get('/settings/support-access').expect(401);
  });

  it('one tenant never sees the grants of another', async () => {
    const other = await seedTenant(db.platform);
    await grantEverything(db, other);
    const otherToken = (await verifiedAdminOf(app, db, other)).accessToken;
    expect((await state(otherToken).expect(200)).body).toEqual({ active: null, history: [] });
    await grantSupport(app, otherToken, { hours: 1, reason: 'Other tenant only' }).expect(201);
    expect((await state().expect(200)).body.history.map((grant: { reason: string }) => grant.reason)).not.toContain('Other tenant only');
  });
});
