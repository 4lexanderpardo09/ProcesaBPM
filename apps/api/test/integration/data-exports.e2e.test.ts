import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { withoutContext } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { ObjectStorage } from '../../src/infrastructure/storage/object-storage.js';
import { TenantPurgeJob } from '../../src/modules/tenant-purge/application/tenant-purge.job.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { seedUser, type TestUser } from '../support/auth-fixtures.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { deletedOrganization } from '../support/deletion-fixtures.js';
import { grantEverything, seedRole } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { grantSupport, openSupportSession, verifiedAdminOf } from '../support/support-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

interface Claim {
  out_tenant_id: string;
  out_export_id: string;
  out_claim_token: string;
}

describe('organization data export (requests and downloads)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let storage: ObjectStorage;
  let platformToken: string;
  let worker: TestingModule | undefined;
  const http = () => request(app.getHttpServer());

  const deleted = () => deletedOrganization(app, db, platformToken);
  const tokenOf = async (user: TestUser, tenant: SeededTenant) => (await signIn(app, user.email, tenant.tenantId)).accessToken;
  const requestExport = (token: string, body: object = {}) => http().post('/data-exports').set(bearer(token)).send({ currentPassword: 'correct horse battery staple', ...body });

  /** What the export worker (next change) does, through the same database functions: claim, write the zip, finish. */
  async function claimed(exportId: string): Promise<Claim> {
    const rows = await withoutContext(db.worker, async (c) => (await c.query<Claim>('SELECT * FROM claim_due_tenant_exports(10)')).rows);
    const claim = rows.find((row) => row.out_export_id === exportId);
    if (claim === undefined) throw new Error(`export ${exportId} was not claimed`);
    return claim;
  }
  async function buildExport(exportId: string, bytes = new TextEncoder().encode(`zip of ${exportId}`)): Promise<{ key: string; bytes: Uint8Array }> {
    const claim = await claimed(exportId);
    const key = `tenants/${claim.out_tenant_id}/exports/${exportId}.zip`;
    expect(await storage.put({ key, body: bytes, contentType: 'application/zip' })).toBe('created');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const finished = await withoutContext(db.worker, async (c) =>
      (await c.query<{ ok: boolean }>('SELECT finish_tenant_export($1, $2, $3, $4, $5, $6::jsonb) AS ok', [claim.out_tenant_id, exportId, claim.out_claim_token, bytes.length, sha, JSON.stringify({ tickets: 2 })])).rows[0]!.ok,
    );
    expect(finished).toBe(true);
    return { key, bytes };
  }
  async function failForGood(exportId: string): Promise<void> {
    const claim = await claimed(exportId);
    await withoutContext(db.worker, (c) => c.query(`SELECT fail_tenant_export($1, $2, $3, 'EXPORT_TOO_LARGE', NULL)`, [claim.out_tenant_id, exportId, claim.out_claim_token]));
  }
  async function readyExport(token: string) {
    const id = (await requestExport(token).expect(202)).body.id as string;
    return { id, ...(await buildExport(id)) };
  }
  const auditRows = async (tenantId: string, action: string) =>
    (await db.owner.query<{ actor_id: string; entity_id: string; after: unknown }>('SELECT actor_id, entity_id, after FROM audit_logs WHERE tenant_id = $1 AND action = $2 ORDER BY created_at', [tenantId, action])).rows;
  const failedLogins = async (userId: string) => (await db.owner.query<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE id = $1', [userId])).rows[0]!.failed_logins;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    storage = app.get(ObjectStorage);
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
  });
  afterAll(async () => {
    await worker?.close();
    await app.close();
    await db.close();
  });

  describe('asking for it', () => {
    it('records the request of the owner (202, PENDING), lists it and audits it', async () => {
      const org = await deleted();
      const token = await tokenOf(org.owner, org.tenant);
      const created = await requestExport(token, { includeFiles: false }).expect(202);
      expect(created.body).toMatchObject({ status: 'PENDING', includeFiles: false, requestedById: org.owner.userId, downloadCount: 0, expiresAt: null, sizeBytes: null });

      const list = await http().get('/data-exports').set(bearer(token)).expect(200);
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([created.body.id]);
      await http().get(`/data-exports/${created.body.id}`).set(bearer(token)).expect(200);
      expect(await auditRows(org.tenant.tenantId, 'data_export.requested')).toEqual([{ actor_id: org.owner.userId, entity_id: created.body.id, after: { includeFiles: false } }]);
    });

    it('checks the password again and counts a wrong one as a failed sign-in', async () => {
      const org = await deleted();
      const token = await tokenOf(org.admin, org.tenant);
      const wrong = await requestExport(token, { currentPassword: 'not my password' });
      expect({ status: wrong.status, code: wrong.body.error?.code }).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
      expect(await failedLogins(org.admin.userId)).toBe(1);
      await http().post('/data-exports').set(bearer(token)).send({ includeFiles: true }).expect(400);
      expect((await http().get('/data-exports').set(bearer(token)).expect(200)).body.items).toEqual([]);
      // The right password clears the counter, as a sign-in does.
      await requestExport(token).expect(202);
      expect(await failedLogins(org.admin.userId)).toBe(0);
    });

    it('keeps one export in flight, at most 5 per organization, and none in the last 6 hours', async () => {
      const org = await deleted();
      const token = await tokenOf(org.owner, org.tenant);
      const first = (await requestExport(token).expect(202)).body.id as string;
      expect((await requestExport(token).expect(409)).body.error.code).toBe('EXPORT_IN_PROGRESS');
      await failForGood(first);
      for (let i = 0; i < 4; i += 1) await failForGood((await requestExport(token).expect(202)).body.id);
      expect((await requestExport(token).expect(422)).body.error).toMatchObject({ code: 'EXPORT_LIMIT_REACHED' });

      const late = await deleted();
      await db.owner.query(`UPDATE tenants SET purge_after = now() + interval '5 hours' WHERE id = $1`, [late.tenant.tenantId]);
      expect((await requestExport(await tokenOf(late.owner, late.tenant)).expect(422)).body.error.code).toBe('EXPORT_TOO_LATE');
    });

    it('two requests at once leave a single export', async () => {
      const org = await deleted();
      const token = await tokenOf(org.owner, org.tenant);
      const statuses = (await Promise.all([requestExport(token), requestExport(token), requestExport(token)])).map((response) => response.status).sort();
      expect(statuses[0]).toBe(202);
      expect(statuses.filter((status) => status === 202)).toHaveLength(1);
      expect(statuses.filter((status) => status !== 202).every((status) => status === 409)).toBe(true);
    });
  });

  describe('downloading it', () => {
    it('signs a short-lived attachment link to the zip under the tenant prefix, counts it and audits it', async () => {
      const org = await deleted();
      const token = await tokenOf(org.owner, org.tenant);
      const { id, key, bytes } = await readyExport(token);
      expect(key.startsWith(`tenants/${org.tenant.tenantId}/exports/`)).toBe(true);
      const detail = (await http().get(`/data-exports/${id}`).set(bearer(token)).expect(200)).body;
      expect(detail).toMatchObject({ status: 'READY', sizeBytes: bytes.length, counts: { tickets: 2 }, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });

      const link = await http().post(`/data-exports/${id}/download-url`).set(bearer(token)).expect(200);
      const seconds = (Date.parse(link.body.expiresAt) - Date.now()) / 1000;
      expect(seconds).toBeGreaterThan(250);
      expect(seconds).toBeLessThanOrEqual(300);
      const download = await fetch(link.body.url);
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
      const slug = (await db.owner.query<{ slug: string }>('SELECT slug FROM tenants WHERE id = $1', [org.tenant.tenantId])).rows[0]!.slug;
      expect(download.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="${slug}-export-\\d{4}-\\d{2}-\\d{2}\\.zip"`));

      expect((await http().get(`/data-exports/${id}`).set(bearer(token)).expect(200)).body).toMatchObject({ downloadCount: 1, lastDownloadedAt: expect.any(String) });
      expect(await auditRows(org.tenant.tenantId, 'data_export.download_url_issued')).toEqual([{ actor_id: org.owner.userId, entity_id: id, after: { downloadCount: 1 } }]);
    });

    it('answers 409 while it is not built, 410 once it expired and 404 for an unknown export', async () => {
      const org = await deleted();
      const token = await tokenOf(org.owner, org.tenant);
      const pending = (await requestExport(token).expect(202)).body.id as string;
      expect((await http().post(`/data-exports/${pending}/download-url`).set(bearer(token)).expect(409)).body.error.code).toBe('EXPORT_NOT_READY');
      await buildExport(pending);
      await db.owner.query(`UPDATE tenant_data_exports SET expires_at = now() - interval '1 second' WHERE id = $1`, [pending]);
      expect((await http().post(`/data-exports/${pending}/download-url`).set(bearer(token)).expect(410)).body.error.code).toBe('EXPORT_EXPIRED');
      await http().post(`/data-exports/${randomUUID()}/download-url`).set(bearer(token)).expect(404);
      await http().get(`/data-exports/${randomUUID()}`).set(bearer(token)).expect(404);
      expect(await auditRows(org.tenant.tenantId, 'data_export.download_url_issued')).toEqual([]);
    });
  });

  describe('who can use it', () => {
    it('a member without full access, an administrator of an active organization, a support visit and a platform session cannot', async () => {
      const tenant = await seedTenant(db.platform);
      await grantEverything(db, tenant);
      const admin = await verifiedAdminOf(app, db, tenant);
      const agent = await seedUser(db, tenant, undefined, { roleId: await seedRole(db, tenant.tenantId, 'Agent') });
      const agentToken = await tokenOf(agent, tenant);
      const exportId = randomUUID();

      const refusals: Array<[string, string, number, string]> = [];
      const probe = async (who: string, token: string) => {
        for (const [method, path] of [
          ['get', '/data-exports'],
          ['get', `/data-exports/${exportId}`],
          ['post', '/data-exports'],
          ['post', `/data-exports/${exportId}/download-url`],
        ] as const) {
          const response = await http()[method](path).set(bearer(token)).send({ currentPassword: 'correct horse battery staple' });
          refusals.push([who, `${method.toUpperCase()} ${path.replace(exportId, ':id')}`, response.status, response.body?.error?.code]);
        }
      };
      await probe('agent', agentToken);
      await probe('admin of an active organization', admin.accessToken);
      await grantSupport(app, admin.accessToken, { hours: 2, reason: 'Checking the export' }).expect(201);
      const visit = (await openSupportSession(app, platformToken, tenant.tenantId).expect(201)).body;
      await probe('support', visit.accessToken);
      await probe('platform', platformToken);

      const expected = (who: string, status: number, code: string, writeStatus = status, writeCode = code) => [
        [who, 'GET /data-exports', status, code],
        [who, 'GET /data-exports/:id', status, code],
        [who, 'POST /data-exports', writeStatus, writeCode],
        [who, 'POST /data-exports/:id/download-url', writeStatus, writeCode],
      ];
      expect(refusals).toEqual([
        ...expected('agent', 403, 'PERMISSION_DENIED'),
        ...expected('admin of an active organization', 422, 'INVALID_STATE'),
        ...expected('support', 403, 'PERMISSION_DENIED', 403, 'SUPPORT_ACCESS_READ_ONLY'),
        ...expected('platform', 401, 'UNAUTHENTICATED'),
      ]);
      expect(await failedLogins(agent.userId)).toBe(0);
      expect((await db.owner.query('SELECT 1 FROM tenant_data_exports WHERE tenant_id = $1', [tenant.tenantId])).rowCount).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it('an organization never sees, reads or downloads the export of another one', async () => {
      const [a, b] = [await deleted(), await deleted()];
      const [tokenA, tokenB] = [await tokenOf(a.owner, a.tenant), await tokenOf(b.owner, b.tenant)];
      const exportA = await readyExport(tokenA);
      const exportB = await readyExport(tokenB);

      expect((await http().get('/data-exports').set(bearer(tokenB)).expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([exportB.id]);
      await http().get(`/data-exports/${exportA.id}`).set(bearer(tokenB)).expect(404);
      await http().post(`/data-exports/${exportA.id}/download-url`).set(bearer(tokenB)).expect(404);
      expect((await db.owner.query('SELECT download_count FROM tenant_data_exports WHERE id = $1', [exportA.id])).rows[0].download_count).toBe(0);

      // Each link points at the organization's own object.
      const link = (await http().post(`/data-exports/${exportB.id}/download-url`).set(bearer(tokenB)).expect(200)).body.url as string;
      expect(link).toContain(`tenants/${b.tenant.tenantId}/exports/${exportB.id}.zip`);
      expect(link).not.toContain(a.tenant.tenantId);
    });
  });

  describe('the purge', () => {
    it('deletes the export zip with the rest of the tenant storage, and the rows with the data', async () => {
      const org = await deleted();
      const { id, key } = await readyExport(await tokenOf(org.owner, org.tenant));
      expect(await storage.head(key)).not.toBeNull();
      await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [org.tenant.tenantId]);

      worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
      await worker.get(TenantPurgeJob).runOnce();

      expect(await storage.head(key)).toBeNull();
      expect((await db.owner.query('SELECT status FROM tenants WHERE id = $1', [org.tenant.tenantId])).rows[0].status).toBe('PURGED');
      expect((await db.owner.query('SELECT 1 FROM tenant_data_exports WHERE id = $1', [id])).rowCount).toBe(0);
    });
  });
});
