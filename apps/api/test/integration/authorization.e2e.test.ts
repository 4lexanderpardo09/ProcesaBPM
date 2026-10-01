import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AbilityService } from '../../src/modules/authorization/application/ability.service.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { addMembership, seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything, seedRole, setRolePermissions } from '../support/permission-fixtures.js';
import { TEST_RECORDS, TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ LOG_LEVEL: 'warn' });

describe('authorization (CASL, deny by default)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let logLines: string[];
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let companyReaderRole: string;
  let noPermissionsRole: string;

  const http = () => request(app.getHttpServer());
  const tokenOf = async (tenant: SeededTenant, options: { roleId?: string } = {}) => {
    const user = await seedUser(db, tenant, undefined, options);
    return (await signIn(app, user.email, tenant.tenantId)).accessToken;
  };
  const get = (path: string, token: string) => http().get(path).set(bearer(token));

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await grantEverything(db, tenantA);
    companyReaderRole = await seedRole(db, tenantA.tenantId, 'Company reader');
    noPermissionsRole = await seedRole(db, tenantA.tenantId, 'Nothing');
    await setRolePermissions(db, tenantA.tenantId, companyReaderRole, [{ action: 'read', subject: 'Company' }]);
    ({ app, logLines } = await createTestApp({ controllers: [TenantProbeController] }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('type-level permissions', () => {
    it('a route that declares no permission answers 403 even for an administrator', async () => {
      const response = await get('/test/undeclared', await tokenOf(tenantA)).expect(403);
      expect(response.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('without a token, an undeclared route is still 401 (authentication comes first)', async () => {
      await http().get('/test/undeclared').expect(401);
    });

    it('a role without the permission answers 403', async () => {
      const token = await tokenOf(tenantA, { roleId: noPermissionsRole });
      expect((await get('/test/companies', token).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
    });

    it('a role with another permission is still refused', async () => {
      await get('/test/invalid-step-change', await tokenOf(tenantA, { roleId: companyReaderRole })).expect(403);
    });

    it('a role with the permission answers 200', async () => {
      await get('/test/companies', await tokenOf(tenantA, { roleId: companyReaderRole })).expect(200);
    });

    it('manage all (administrator) opens every declared route', async () => {
      await get('/test/companies', await tokenOf(tenantA)).expect(200);
    });

    it('authenticated-only routes need no permission: a member with no permissions can read their profile', async () => {
      await get('/auth/me', await tokenOf(tenantA, { roleId: noPermissionsRole })).expect(200);
    });

    it('does not tell the client what is missing', async () => {
      const response = await get('/test/companies', await tokenOf(tenantA, { roleId: noPermissionsRole })).expect(403);
      expect(JSON.stringify(response.body)).not.toMatch(/Company|read|permission on/i);
    });
  });

  describe('the role comes from the database, never from the token', () => {
    it('removing a permission takes effect on the next request, once the cache entry is invalidated', async () => {
      const role = await seedRole(db, tenantA.tenantId, 'Temporary');
      await setRolePermissions(db, tenantA.tenantId, role, [{ action: 'read', subject: 'Company' }]);
      const token = await tokenOf(tenantA, { roleId: role });
      await get('/test/companies', token).expect(200);

      await setRolePermissions(db, tenantA.tenantId, role, []);
      await get('/test/companies', token).expect(200); // still cached: the change is not announced yet
      await app.get(AbilityService).invalidateRole(tenantA.tenantId, role);
      await get('/test/companies', token).expect(403);
    });

    it('granting a permission is seen after invalidating the role', async () => {
      const role = await seedRole(db, tenantA.tenantId, 'Growing');
      const token = await tokenOf(tenantA, { roleId: role });
      await get('/test/companies', token).expect(403);
      await setRolePermissions(db, tenantA.tenantId, role, [{ action: 'read', subject: 'Company' }]);
      await get('/test/companies', token).expect(403); // cached empty rules
      await app.get(AbilityService).invalidateTenant(tenantA.tenantId);
      await get('/test/companies', token).expect(200);
    });

    it('moving a member to another role applies at once (the role is read on every request)', async () => {
      const user = await seedUser(db, tenantA, undefined, { roleId: companyReaderRole });
      const { accessToken } = await signIn(app, user.email, tenantA.tenantId);
      await get('/test/companies', accessToken).expect(200);
      await db.platform.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [noPermissionsRole, tenantA.tenantId, user.userId]);
      await get('/test/companies', accessToken).expect(403);
    });

    it('a deactivated role grants nothing', async () => {
      const role = await seedRole(db, tenantA.tenantId, 'Soon inactive');
      await setRolePermissions(db, tenantA.tenantId, role, [{ action: 'manage', subject: 'all' }]);
      const token = await tokenOf(tenantA, { roleId: role });
      await get('/test/companies', token).expect(200);
      await db.platform.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenantA.tenantId, role]);
      await get('/test/companies', token).expect(403);
    });
  });

  describe('tenant isolation of permissions', () => {
    it('the role of one tenant never applies in another tenant', async () => {
      await grantEverything(db, tenantB);
      const user = await seedUser(db, tenantA, undefined, { roleId: noPermissionsRole });
      const inA = await signIn(app, user.email, tenantA.tenantId);
      await get('/test/companies', inA.accessToken).expect(403);

      // The same person is an administrator in tenant B: that role is read inside tenant B only.
      await addMembership(db, tenantB, user.userId); // joins with tenant B's administrator role
      const inB = await signIn(app, user.email, tenantB.tenantId);
      const [a, b] = await Promise.all([get('/test/companies', inA.accessToken), get('/test/companies', inB.accessToken)]);
      expect([a.status, b.status]).toEqual([403, 200]);
      expect(b.body.map((row: { tenantId: string }) => row.tenantId)).toEqual([tenantB.tenantId]);
    });

    it('an invalid role id in the cache key cannot be shared: each tenant and role has its own entry', async () => {
      const abilities = app.get(AbilityService);
      await abilities.invalidateTenant(tenantA.tenantId);
      const token = await tokenOf(tenantA, { roleId: companyReaderRole });
      await get('/test/companies', token).expect(200);
      await abilities.invalidateTenant(tenantB.tenantId);
      await get('/test/companies', token).expect(200);
    });
  });

  describe('conditions and records (fake subject TestDoc)', () => {
    let ana: string;
    let luis: string;
    let viewer: string;

    beforeAll(async () => {
      const own = await seedRole(db, tenantA.tenantId, 'Own docs');
      const everything = await seedRole(db, tenantA.tenantId, 'All docs');
      await setRolePermissions(db, tenantA.tenantId, own, [{ action: 'read_own', subject: 'TestDoc' }]);
      await setRolePermissions(db, tenantA.tenantId, everything, [{ action: 'read_all', subject: 'TestDoc' }]);
      const anaUser = await seedUser(db, tenantA, undefined, { roleId: own });
      const luisUser = await seedUser(db, tenantA, undefined, { roleId: own });
      TEST_RECORDS.push({ id: 'doc-ana', ownerId: anaUser.userId }, { id: 'doc-luis', ownerId: luisUser.userId });
      ana = (await signIn(app, anaUser.email, tenantA.tenantId)).accessToken;
      luis = (await signIn(app, luisUser.email, tenantA.tenantId)).accessToken;
      viewer = await tokenOf(tenantA, { roleId: everything });
    });

    it('own record: 200; another member\'s record: 403', async () => {
      await get('/test/records/doc-ana', ana).expect(200);
      await get('/test/records/doc-luis', ana).expect(403);
      await get('/test/records/doc-luis', luis).expect(200);
    });

    it('read_all sees any record', async () => {
      await get('/test/records/doc-ana', viewer).expect(200);
      await get('/test/records/doc-luis', viewer).expect(200);
    });

    it('the listing filter keeps only what the caller may see, and never everything for a role without rules', async () => {
      const own = await get('/test/records', ana).expect(200);
      expect(own.body.where).toEqual({ OR: [{ ownerId: expect.stringMatching(/^[0-9a-f-]{36}$/) }] });
      const all = await get('/test/records', viewer).expect(200);
      expect(all.body.where).toEqual({}); // an unconditional rule: every record
      const nobody = await tokenOf(tenantA, { roleId: noPermissionsRole });
      await get('/test/records', nobody).expect(403); // no rule: the route itself is refused
    });

    it('rules whose conditions are not valid are dropped and logged, never widened', async () => {
      const bad = await seedRole(db, tenantA.tenantId, 'Bad conditions');
      await setRolePermissions(db, tenantA.tenantId, bad, [
        { action: 'read_all', subject: 'TestDoc', conditions: { secretColumn: 'x' } },
        { action: 'read_own', subject: 'TestDoc', conditions: { ownerId: 'prefix-${user.id}' } },
      ]);
      const token = await tokenOf(tenantA, { roleId: bad });
      await get('/test/records/doc-ana', token).expect(403);
      expect(logLines.some((line) => (JSON.parse(line) as { event?: string }).event === 'authorization.rule_dropped')).toBe(true);
    });
  });
});
