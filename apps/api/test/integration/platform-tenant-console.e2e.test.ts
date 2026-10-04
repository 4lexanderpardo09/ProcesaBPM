import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedMember, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const GIB = 1024n ** 3n;
const unknownId = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';

describe('platform console: tenants', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  let adminUserId: string;
  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set(bearer(token));
  const put = (path: string, body: object) => http().put(path).set(bearer(token)).send(body);

  const named = async (name: string, options: { plan?: string; status?: string } = {}): Promise<SeededTenant> => {
    const tenant = await seedTenant(db.platform);
    await db.owner.query(
      `UPDATE tenants SET name = $2, plan_id = (SELECT id FROM plans WHERE code = $3), status = $4::tenant_status WHERE id = $1`,
      [tenant.tenantId, name, options.plan ?? 'professional', options.status ?? 'ACTIVE'],
    );
    return tenant;
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    const admin = await seedPlatformAdmin(db);
    adminUserId = admin.userId;
    token = await signInPlatform(app, db, admin);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('GET /platform/tenants', () => {
    it('searches by name or slug, filters by status and plan, and paginates newest first', async () => {
      const marker = `Zeta${Math.random().toString(36).slice(2, 8)}`;
      const first = await named(`${marker} one`);
      const second = await named(`${marker} two`, { plan: 'basic' });
      const third = await named(`${marker} three`, { status: 'SUSPENDED' });

      const all = await get(`/platform/tenants?search=${marker.toLowerCase()}`).expect(200);
      expect(all.body.total).toBe(3);
      expect(all.body.items.map((item: { tenantId: string }) => item.tenantId)).toEqual([third.tenantId, second.tenantId, first.tenantId]);

      const suspended = await get(`/platform/tenants?search=${marker}&status=SUSPENDED`).expect(200);
      expect(suspended.body.items.map((item: { tenantId: string }) => item.tenantId)).toEqual([third.tenantId]);
      const basic = await get(`/platform/tenants?search=${marker}&planCode=basic`).expect(200);
      expect(basic.body.items).toEqual([expect.objectContaining({ tenantId: second.tenantId, planCode: 'basic' })]);

      const page2 = await get(`/platform/tenants?search=${marker}&pageSize=2&page=2`).expect(200);
      expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(page2.body.items).toHaveLength(1);
      await get('/platform/tenants?status=NOPE').expect(400);
    });
  });

  describe('GET /platform/tenants/:id', () => {
    it('shows aggregates only: plan, owner, counts, storage against the quota, never member data', async () => {
      const tenant = await named('Detail Corp', { plan: 'professional' });
      await seedMember(db.platform, tenant);
      await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      await db.owner.query(`INSERT INTO tenant_usage (tenant_id, bytes_used, bytes_reserved) VALUES ($1, $2, 0) ON CONFLICT (tenant_id) DO UPDATE SET bytes_used = $2`, [tenant.tenantId, (3n * GIB).toString()]);

      const { body } = await get(`/platform/tenants/${tenant.tenantId}`).expect(200);

      expect(body).toMatchObject({
        tenantId: tenant.tenantId,
        name: 'Detail Corp',
        status: 'ACTIVE',
        plan: { code: 'professional' },
        companies: 1,
        activeUsers: 2,
        ticketsLast30Days: 0,
        suspension: null,
        dataExport: null,
        owner: { membershipStatus: 'ACTIVE' },
      });
      // professional: 25 GiB + 2 GiB per active user (2) + 0 extra; 5 % grace.
      const limit = 29n * GIB;
      expect(body.storage).toMatchObject({ usedBytes: (3n * GIB).toString(), limitBytes: limit.toString(), hardLimitBytes: (limit + (limit * 5n) / 100n).toString(), state: 'OK' });
      expect(Object.keys(body.owner).sort()).toEqual(['email', 'firstName', 'lastName', 'membershipStatus']);
    });

    it('reports why and when a tenant was suspended', async () => {
      const tenant = await named('Suspended Corp');
      await http().post(`/platform/tenants/${tenant.tenantId}/suspend`).set(bearer(token)).send({ reason: 'Unpaid invoice' }).expect(200);
      const { body } = await get(`/platform/tenants/${tenant.tenantId}`).expect(200);
      expect(body.suspension).toEqual({ reason: 'Unpaid invoice', at: expect.any(String) });
    });

    it('answers 404 for an unknown tenant and 400 for a malformed id', async () => {
      await get(`/platform/tenants/${unknownId}`).expect(404);
      await get('/platform/tenants/nope').expect(400);
    });
  });

  describe('PUT /platform/tenants/:id/plan', () => {
    it('changes the plan and audits the change', async () => {
      const tenant = await named('Plan Corp');
      const { body } = await put(`/platform/tenants/${tenant.tenantId}/plan`, { planCode: 'enterprise' }).expect(200);
      expect(body.plan.code).toBe('enterprise');
      const log = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE target_tenant_id = $1 AND action = 'tenant.plan_changed'`, [tenant.tenantId]);
      expect(log.rows).toEqual([{ data: { from: 'professional', to: 'enterprise' } }]);
    });

    it('refuses an unknown plan (422) and a plan with fewer seats than active users (422)', async () => {
      const tenant = await named('Seats Corp');
      for (let i = 0; i < 5; i += 1) await seedMember(db.platform, tenant);
      await put(`/platform/tenants/${tenant.tenantId}/plan`, { planCode: 'nope' }).expect(422);
      const response = await put(`/platform/tenants/${tenant.tenantId}/plan`, { planCode: 'trial' }).expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });

    it('answers 404 for an unknown tenant', async () => {
      await put(`/platform/tenants/${unknownId}/plan`, { planCode: 'basic' }).expect(404);
    });
  });

  describe('PUT /platform/tenants/:id/extra-storage', () => {
    it('raises the quota and audits it; repeating the same value changes nothing', async () => {
      const tenant = await named('Storage Corp');
      const before = BigInt((await get(`/platform/tenants/${tenant.tenantId}`).expect(200)).body.storage.limitBytes);
      const { body } = await put(`/platform/tenants/${tenant.tenantId}/extra-storage`, { extraStorageBytes: (10n * GIB).toString() }).expect(200);
      expect(BigInt(body.storage.limitBytes)).toBe(before + 10n * GIB);
      await put(`/platform/tenants/${tenant.tenantId}/extra-storage`, { extraStorageBytes: (10n * GIB).toString() }).expect(200);
      const log = await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE target_tenant_id = $1 AND action = 'tenant.extra_storage_changed'`, [tenant.tenantId]);
      expect(log.rowCount).toBe(1);
    });

    it('refuses negative or non-numeric values', async () => {
      const tenant = await named('Storage Corp 2');
      await put(`/platform/tenants/${tenant.tenantId}/extra-storage`, { extraStorageBytes: '-1' }).expect(400);
      await put(`/platform/tenants/${tenant.tenantId}/extra-storage`, { extraStorageBytes: '1e9' }).expect(400);
      await put(`/platform/tenants/${tenant.tenantId}/extra-storage`, { extraStorageBytes: 10 }).expect(400);
    });
  });

  describe('POST /platform/tenants/:id/owner-invitation', () => {
    it('queues another invitation e-mail while the owner has not accepted', async () => {
      const tenant = await named('Invite Corp');
      await db.owner.query(`UPDATE memberships SET is_owner = true, status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      await http().post(`/platform/tenants/${tenant.tenantId}/owner-invitation`).set(bearer(token)).expect(204);
      const events = await db.owner.query(`SELECT payload FROM platform_outbox_events WHERE type = 'email.invitation' AND payload ->> 'tenantId' = $1`, [tenant.tenantId]);
      expect(events.rows).toEqual([{ payload: { tenantId: tenant.tenantId, userId: tenant.userId } }]);
      const log = await db.owner.query(`SELECT actor_user_id FROM platform_audit_logs WHERE target_tenant_id = $1 AND action = 'tenant.owner_invitation_resent'`, [tenant.tenantId]);
      expect(log.rows).toEqual([{ actor_user_id: adminUserId }]);
    });

    it('refuses (422) for a suspended tenant: the worker would send nothing', async () => {
      const tenant = await named('Suspended Invite Corp', { status: 'SUSPENDED' });
      await db.owner.query(`UPDATE memberships SET is_owner = true, status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      await http().post(`/platform/tenants/${tenant.tenantId}/owner-invitation`).set(bearer(token)).expect(422);
    });

    it('refuses (422) when the owner already accepted, and answers 404 for an unknown tenant', async () => {
      const tenant = await named('Accepted Corp');
      await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      await http().post(`/platform/tenants/${tenant.tenantId}/owner-invitation`).set(bearer(token)).expect(422);
      await http().post(`/platform/tenants/${unknownId}/owner-invitation`).set(bearer(token)).expect(404);
    });
  });

  describe('access control', () => {
    it('a tenant user, even of that tenant, gets 403 on every console route', async () => {
      const tenant = await named('Closed Corp');
      const user = await seedUser(db, tenant);
      const { accessToken } = await signIn(app, user.email, tenant.tenantId);
      const id = tenant.tenantId;
      await http().get('/platform/tenants').set(bearer(accessToken)).expect(403);
      await http().get(`/platform/tenants/${id}`).set(bearer(accessToken)).expect(403);
      await http().put(`/platform/tenants/${id}/plan`).set(bearer(accessToken)).send({ planCode: 'basic' }).expect(403);
      await http().put(`/platform/tenants/${id}/extra-storage`).set(bearer(accessToken)).send({ extraStorageBytes: '1' }).expect(403);
      await http().post(`/platform/tenants/${id}/owner-invitation`).set(bearer(accessToken)).expect(403);
      await http().get('/platform/tenants').expect(401);
    });
  });
});
