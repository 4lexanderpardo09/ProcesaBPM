import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { ObjectStorage } from '../../src/infrastructure/storage/object-storage.js';
import { TenantPurgeJob } from '../../src/modules/tenant-purge/application/tenant-purge.job.js';
import { WorkerModule } from '../../src/worker.module.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { grantSupport, openSupportSession, verifiedAdminOf } from '../support/support-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

describe('deleting a tenant', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let storage: ObjectStorage;
  let platformToken: string;
  let mail: MailWorker;
  const flaky = { deleteFailuresLeft: 0 };
  const workers: TestingModule[] = [];
  const http = () => request(app.getHttpServer());
  const asPlatform = (req: request.Test) => req.set(bearer(platformToken));
  const deletion = (tenant: SeededTenant, body: object) => asPlatform(http().post(`/platform/tenants/${tenant.tenantId}/deletion`)).send(body);

  async function startWorker(): Promise<TenantPurgeJob> {
    const module = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    workers.push(module);
    // The storage of this worker fails its batch deletes while `flaky.deleteFailuresLeft` says so (a storage outage).
    const workerStorage = module.get(ObjectStorage);
    const deleteMany = workerStorage.deleteMany.bind(workerStorage);
    workerStorage.deleteMany = async (keys) => {
      if (flaky.deleteFailuresLeft > 0) {
        flaky.deleteFailuresLeft -= 1;
        return { failed: keys };
      }
      return deleteMany(keys);
    };
    return module.get(TenantPurgeJob);
  }

  /** An organization with an administrator (MFA passed), some objects in storage, and a member. */
  async function tenantWithData(objects = 3) {
    const tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    const admin = await verifiedAdminOf(app, db, tenant);
    await db.owner.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [tenant.tenantId, `Doomed ${tenant.tenantId.slice(0, 8)}`]);
    await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, admin.user.userId]);
    const keys = Array.from({ length: objects }, (_, i) => `tenants/${tenant.tenantId}/2026/10/${randomUUID()}-${i}`);
    await Promise.all(keys.map((key) => storage.put({ key, body: new Uint8Array([1, 2, 3]), contentType: 'application/octet-stream' })));
    const name = (await db.owner.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenant.tenantId])).rows[0]!.name;
    return { tenant, admin, keys, name };
  }
  const tenantRow = async (id: string) => (await db.owner.query('SELECT * FROM tenants WHERE id = $1', [id])).rows[0];
  const makeDue = (tenant: SeededTenant) => db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [tenant.tenantId]);
  const listed = async (tenant: SeededTenant) => (await storage.listKeys(`tenants/${tenant.tenantId}/`, 1000)).length;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    storage = app.get(ObjectStorage);
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await Promise.all(workers.map((module) => module.close()));
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('asking for it', () => {
    it('is refused (422) when the name does not match, and nothing changes', async () => {
      const { tenant } = await tenantWithData();
      expect((await deletion(tenant, { confirmName: 'Not the name', reason: 'Customer asked' }).expect(422)).body.error.code).toBe('INVALID_STATE');
      expect((await tenantRow(tenant.tenantId)).status).toBe('ACTIVE');
      await deletion(tenant, { confirmName: 'x' }).expect(400);
    });

    it('locks the tenant for 30 days, ends sessions and support access, tells the owner and audits it', async () => {
      const { tenant, admin, name } = await tenantWithData();
      const support = (await grantSupport(app, admin.accessToken, { hours: 5, reason: 'Support please' }).expect(201)).body;
      const visit = (await openSupportSession(app, platformToken, tenant.tenantId).expect(201)).body;
      await http().get('/companies').set(bearer(visit.accessToken)).expect(200);

      const response = await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      expect(response.body).toMatchObject({ tenantId: tenant.tenantId, status: 'PENDING_DELETION' });
      const days = (Date.parse(response.body.purgeAfter) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);

      // Everyone is out at once: sessions, refresh, and the support visit.
      await http().get('/auth/me').set(bearer(admin.accessToken)).expect(401);
      await http().get('/companies').set(bearer(visit.accessToken)).expect(401);
      const grants = await db.owner.query('SELECT revoked_at, revoked_by_id FROM support_access_grants WHERE id = $1', [support.id]);
      expect(grants.rows[0].revoked_at).not.toBeNull();
      expect(grants.rows[0].revoked_by_id).toBeNull();
      await openSupportSession(app, platformToken, tenant.tenantId).expect(403);

      // A new sign-in lists the organization and choosing it explains why it is closed.
      const member = await seedUser(db, tenant);
      const login = await http().post('/auth/login').send({ email: member.email, password: member.password }).expect(200);
      expect(login.body.organizations.map((org: { tenantId: string }) => org.tenantId)).toContain(tenant.tenantId);
      const selected = await http().post('/auth/select-tenant').set(bearer(login.body.selectionToken)).send({ tenantId: tenant.tenantId });
      expect(selected.status, JSON.stringify(selected.body)).toBe(403);
      expect(selected.body.error.code).toBe('TENANT_PENDING_DELETION');

      // The owner is told, without any link.
      const message = await mail.waitForMail(admin.user.email);
      expect(message.subject).toContain('eliminación');
      expect(message.text).toContain(name);
      expect(message.text).not.toMatch(/https?:\/\//);

      const log = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE action = 'tenant.deletion_requested' AND target_tenant_id = $1`, [tenant.tenantId]);
      expect(log.rows).toEqual([{ data: expect.objectContaining({ reason: 'Customer asked to leave', previousStatus: 'ACTIVE' }) }]);
      const detail = (await asPlatform(http().get(`/platform/tenants/${tenant.tenantId}`)).expect(200)).body;
      expect(detail).toMatchObject({ status: 'PENDING_DELETION', deletion: { purgeAfter: response.body.purgeAfter, purgedAt: null } });
    });

    it('also works for a suspended tenant, and is refused twice', async () => {
      const { tenant, name } = await tenantWithData(1);
      await asPlatform(http().post(`/platform/tenants/${tenant.tenantId}/suspend`)).send({ reason: 'Unpaid invoice' }).expect(200);
      await deletion(tenant, { confirmName: name, reason: 'Gone for good' }).expect(200);
      expect((await deletion(tenant, { confirmName: name, reason: 'Again' }).expect(422)).body.error.code).toBe('INVALID_STATE');
      await asPlatform(http().post(`/platform/tenants/${tenant.tenantId}/reactivate`)).send({}).expect(422);
    });

    it('answers 404 for an unknown tenant and 403 to a tenant user', async () => {
      await deletion({ tenantId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' } as SeededTenant, { confirmName: 'x', reason: 'none at all' }).expect(404);
      const { tenant, admin, name } = await tenantWithData(1);
      await http().post(`/platform/tenants/${tenant.tenantId}/deletion`).set(bearer(admin.accessToken)).send({ confirmName: name, reason: 'sneaky' }).expect(403);
      await http().delete(`/platform/tenants/${tenant.tenantId}/deletion`).set(bearer(admin.accessToken)).expect(403);
      await http().post(`/platform/tenants/${tenant.tenantId}/deletion`).send({}).expect(401);
      expect((await tenantRow(tenant.tenantId)).status).toBe('ACTIVE');
    });
  });

  describe('cancelling', () => {
    it('within the period leaves the tenant SUSPENDED; reactivating is a separate step', async () => {
      const { tenant, name } = await tenantWithData(1);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      const cancelled = await asPlatform(http().delete(`/platform/tenants/${tenant.tenantId}/deletion`)).expect(200);
      expect(cancelled.body).toEqual({ tenantId: tenant.tenantId, status: 'SUSPENDED', purgeAfter: null });
      expect(await tenantRow(tenant.tenantId)).toMatchObject({ status: 'SUSPENDED', purge_after: null, deletion_requested_at: null, deletion_requested_by_id: null });
      const member = await seedUser(db, tenant);
      const login = await http().post('/auth/login').send({ email: member.email, password: member.password }).expect(200);
      expect((await http().post('/auth/select-tenant').set(bearer(login.body.selectionToken)).send({ tenantId: tenant.tenantId }).expect(403)).body.error.code).toBe('TENANT_SUSPENDED');
      await asPlatform(http().post(`/platform/tenants/${tenant.tenantId}/reactivate`)).send({}).expect(200);
      await signIn(app, member.email, tenant.tenantId);
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE action = 'tenant.deletion_cancelled' AND target_tenant_id = $1`, [tenant.tenantId])).rowCount).toBe(1);
    });

    it('is refused when the tenant is not pending deletion or the period is over', async () => {
      const { tenant, name } = await tenantWithData(1);
      await asPlatform(http().delete(`/platform/tenants/${tenant.tenantId}/deletion`)).expect(422);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      await makeDue(tenant);
      expect((await asPlatform(http().delete(`/platform/tenants/${tenant.tenantId}/deletion`)).expect(422)).body.error.code).toBe('INVALID_STATE');
      expect((await tenantRow(tenant.tenantId)).status).toBe('PENDING_DELETION');
    });
  });

  describe('the purge', () => {
    it('does nothing before the deadline', async () => {
      const job = await startWorker();
      const { tenant, name, keys } = await tenantWithData(2);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      // (A tenant left due by an earlier test may be purged by this run: only this one is asserted.)
      await job.runOnce();
      expect(await listed(tenant)).toBe(keys.length);
      expect((await tenantRow(tenant.tenantId)).status).toBe('PENDING_DELETION');
    });

    it('after the deadline removes the objects (in batches) and the data, leaves a tombstone, and spares the others', async () => {
      const job = await startWorker();
      const { tenant, name } = await tenantWithData(1105);
      const bystander = await tenantWithData(3);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      expect(await listed(tenant)).toBe(1000);
      await makeDue(tenant);

      const result = await job.runOnce();

      expect(result).toMatchObject({ purged: 1, failed: 0 });
      expect(await listed(tenant)).toBe(0);
      expect(await tenantRow(tenant.tenantId)).toMatchObject({ status: 'PURGED', slug: expect.any(String), name, purge_after: null });
      for (const table of ['companies', 'memberships', 'roles', 'audit_logs']) {
        expect((await db.owner.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1`, [tenant.tenantId])).rowCount, table).toBe(0);
      }
      expect(await listed(bystander.tenant)).toBe(3);
      expect((await tenantRow(bystander.tenant.tenantId)).status).toBe('ACTIVE');
      expect((await db.owner.query('SELECT 1 FROM companies WHERE tenant_id = $1', [bystander.tenant.tenantId])).rowCount).toBeGreaterThan(0);
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE action = 'tenant.purged' AND target_tenant_id = $1`, [tenant.tenantId])).rowCount).toBe(1);
      const detail = (await asPlatform(http().get(`/platform/tenants/${tenant.tenantId}`)).expect(200)).body;
      expect(detail).toMatchObject({ status: 'PURGED', deletion: { purgedAt: expect.any(String), purgeAfter: null } });
      await asPlatform(http().put(`/platform/tenants/${tenant.tenantId}/plan`)).send({ planCode: 'basic' }).expect(422);
    });

    it('never processes a purged tenant again', async () => {
      const job = await startWorker();
      const { tenant, name } = await tenantWithData(1);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      await makeDue(tenant);
      const first = await job.runOnce();
      expect(first.purged, JSON.stringify((await tenantRow(tenant.tenantId)).purge_last_error)).toBe(1);
      expect(await job.runOnce()).toEqual({ claimed: 0, purged: 0, failed: 0 });
    });

    it('a storage failure is retried with a backoff and then finishes; the data stays until the files are gone', async () => {
      const job = await startWorker();
      const { tenant, name } = await tenantWithData(4);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      await makeDue(tenant);
      flaky.deleteFailuresLeft = 1;

      expect(await job.runOnce()).toMatchObject({ claimed: 1, purged: 0, failed: 1 });
      const afterFailure = await tenantRow(tenant.tenantId);
      expect(afterFailure).toMatchObject({ status: 'PENDING_DELETION', purge_lease_until: null });
      expect(afterFailure.purge_last_error).toContain('Could not delete');
      expect(afterFailure.purge_retry_at.getTime()).toBeGreaterThan(Date.now());
      expect((await db.owner.query('SELECT 1 FROM companies WHERE tenant_id = $1', [tenant.tenantId])).rowCount).toBeGreaterThan(0);

      expect(await job.runOnce()).toMatchObject({ claimed: 0 });
      await db.owner.query(`UPDATE tenants SET purge_retry_at = now() - interval '1 second' WHERE id = $1`, [tenant.tenantId]);
      expect(await job.runOnce()).toMatchObject({ claimed: 1, purged: 1, failed: 0 });
      expect((await tenantRow(tenant.tenantId)).status).toBe('PURGED');
      expect(await listed(tenant)).toBe(0);
    });

    it('resumes when the files are already gone (a crash between the steps): the data step still runs', async () => {
      const job = await startWorker();
      const { tenant, name, keys } = await tenantWithData(3);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      await makeDue(tenant);
      await storage.deleteMany(keys);
      expect(await job.runOnce()).toMatchObject({ purged: 1, failed: 0 });
      expect((await tenantRow(tenant.tenantId)).status).toBe('PURGED');
    });

    it('two workers at the same time purge a tenant once', async () => {
      const [first, second] = [await startWorker(), await startWorker()];
      const { tenant, name } = await tenantWithData(30);
      await deletion(tenant, { confirmName: name, reason: 'Customer asked to leave' }).expect(200);
      await makeDue(tenant);

      const results = await Promise.all([first.runOnce(), second.runOnce()]);

      expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(1);
      expect(results.reduce((total, result) => total + result.purged, 0)).toBe(1);
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE action = 'tenant.purged' AND target_tenant_id = $1`, [tenant.tenantId])).rowCount).toBe(1);
      expect(await listed(tenant)).toBe(0);
    });
  });

});
