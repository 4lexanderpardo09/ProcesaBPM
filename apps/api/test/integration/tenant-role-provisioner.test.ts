import type { INestApplication } from '@nestjs/common';
import { ROLE_TEMPLATES, type RoleTemplate } from '@procesabpm/db';
import { connectTestDatabase, withContext, type TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { MissingCatalogPermissionError } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformPrismaService } from '../../src/infrastructure/database/platform-prisma.service.js';
import { TenantRoleProvisioner } from '../../src/modules/platform/application/tenant-role-provisioner.js';
import { TenantRoleRepository } from '../../src/modules/platform/data/tenant-role.repository.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';
import request from 'supertest';

useTestEnvironment();

describe('TenantRoleProvisioner (platform service)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let provisioner: TenantRoleProvisioner;
  let platform: PlatformPrismaService;

  /** A tenant row with no roles at all, as the sign-up will create it before provisioning. */
  const bareTenant = async () =>
    insertReturningId(
      db.platform,
      `INSERT INTO tenants (slug, name, plan_id, country_code, time_zone)
       SELECT $1, 'Bare tenant', id, 'CO', 'America/Bogota' FROM plans WHERE code = 'professional' RETURNING id`,
      [`bare-${Math.random().toString(36).slice(2, 10)}`],
    );

  const rolesOf = async (tenantId: string) =>
    (
      await db.owner.query<{ system_role: string; name: string; is_admin: boolean; permissions: string[] }>(
        `SELECT r.system_role, r.name, r.is_admin,
                coalesce(array_agg(p.action || ' ' || p.subject ORDER BY p.action, p.subject) FILTER (WHERE p.id IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE r.tenant_id = $1 GROUP BY r.tenant_id, r.id ORDER BY r.system_role`,
        [tenantId],
      )
    ).rows;

  const expectedPermissions = (template: RoleTemplate) =>
    template.permissions.map(({ action, subject }) => `${action} ${subject}`).sort((a, b) => (a < b ? -1 : 1));

  beforeAll(async () => {
    db = connectTestDatabase();
    const created = await createTestApp({ controllers: [TenantProbeController] });
    app = created.app;
    provisioner = created.moduleRef.get(TenantRoleProvisioner);
    platform = created.moduleRef.get(PlatformPrismaService);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('creates the four base roles with the permissions of ROLE_TEMPLATES', async () => {
    const tenantId = await bareTenant();
    const created = await provisioner.createBaseRoles(tenantId);

    expect(created.map((role) => role.systemRole).sort()).toEqual(['ADMIN', 'AGENT', 'REQUESTER', 'SUPERVISOR']);
    const stored = await rolesOf(tenantId);
    expect(stored).toHaveLength(ROLE_TEMPLATES.length);
    for (const template of ROLE_TEMPLATES) {
      const role = stored.find((candidate) => candidate.system_role === template.systemRole)!;
      expect(role).toMatchObject({ name: template.name, is_admin: template.isAdmin });
      expect([...role.permissions].sort()).toEqual(expectedPermissions(template));
    }
    expect(created.find((role) => role.systemRole === 'ADMIN')!.permissionCount).toBe(1);
  });

  it('the administrator gets manage all and nobody else does', async () => {
    const tenantId = await bareTenant();
    await provisioner.createBaseRoles(tenantId);
    const withManageAll = (await rolesOf(tenantId)).filter((role) => role.permissions.includes('manage all'));
    expect(withManageAll.map((role) => role.system_role)).toEqual(['ADMIN']);
  });

  it('what it creates is invisible from another tenant (and from the other way round)', async () => {
    const [first, second] = [await bareTenant(), await seedTenant(db.platform)];
    await provisioner.createBaseRoles(first);
    const seen = await withContext(db.runtime, { tenantId: second.tenantId, userId: second.userId }, async (client) =>
      (await client.query<{ tenant_id: string }>('SELECT tenant_id FROM roles')).rows.map((row) => row.tenant_id),
    );
    expect(seen).not.toContain(first);
    expect(new Set(seen)).toEqual(new Set([second.tenantId]));
  });

  it('writes every row with the tenant it was asked for', async () => {
    const [first, second] = [await bareTenant(), await bareTenant()];
    await provisioner.createBaseRoles(first);
    await provisioner.createBaseRoles(second);
    const { rows } = await db.owner.query<{ tenant_id: string; n: string }>(
      `SELECT tenant_id, count(*) AS n FROM role_permissions WHERE tenant_id = ANY($1) GROUP BY tenant_id`,
      [[first, second]],
    );
    expect(new Map(rows.map((row) => [row.tenant_id, Number(row.n)])).size).toBe(2);
    expect(new Set(rows.map((row) => row.n)).size).toBe(1);
  });

  it('is not idempotent: a second call for the same tenant fails and changes nothing', async () => {
    const tenantId = await bareTenant();
    await provisioner.createBaseRoles(tenantId);
    const before = await rolesOf(tenantId);
    await expect(provisioner.createBaseRoles(tenantId)).rejects.toMatchObject({ code: 'P2002' });
    expect(await rolesOf(tenantId)).toEqual(before);
  });

  it('a template that names a permission missing from the catalog fails before writing anything', async () => {
    const tenantId = await bareTenant();
    const templates: RoleTemplate[] = [
      ...ROLE_TEMPLATES,
      { systemRole: 'AGENT', name: 'Broken', isAdmin: false, permissions: [{ action: 'teleport', subject: 'Ticket' }, { action: 'fly', subject: 'Ticket' }] },
    ];
    const broken = new TenantRoleProvisioner(platform, new TenantRoleRepository(), templates);
    const failure = await broken.createBaseRoles(tenantId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MissingCatalogPermissionError);
    expect((failure as MissingCatalogPermissionError).missing).toEqual(['fly Ticket', 'teleport Ticket']);
    expect(await rolesOf(tenantId)).toEqual([]);
  });

  it('joins the transaction of the caller: if the caller fails afterwards, the roles are rolled back too', async () => {
    const tenantId = await bareTenant();
    await expect(
      platform.$transaction(async (tx) => {
        await provisioner.createBaseRoles(tenantId, tx);
        expect((await tx.role.count({ where: { tenantId } }))).toBe(ROLE_TEMPLATES.length);
        throw new Error('sign-up failed after provisioning');
      }),
    ).rejects.toThrow('sign-up failed after provisioning');
    expect(await rolesOf(tenantId)).toEqual([]);
  });

  it('members of a provisioned tenant authorize with the provisioned roles, end to end', async () => {
    const tenantId = await bareTenant();
    const roles = await provisioner.createBaseRoles(tenantId);
    const roleOf = (systemRole: string) => roles.find((role) => role.systemRole === systemRole)!.id;
    const companyId = await insertReturningId(
      db.platform,
      `INSERT INTO companies (tenant_id, name, is_default, country_code, currency_code, time_zone)
       VALUES ($1, 'Main', true, 'CO', 'COP', 'America/Bogota') RETURNING id`,
      [tenantId],
    );
    const tenant = { tenantId, companyId, roleId: roleOf('ADMIN'), userId: '' } as SeededTenant;
    const admin = await seedUser(db, tenant);
    const requester = await seedUser(db, tenant, undefined, { roleId: roleOf('REQUESTER') });
    const adminToken = (await signIn(app, admin.email, tenantId)).accessToken;
    const requesterToken = (await signIn(app, requester.email, tenantId)).accessToken;
    const missingStep = '00000000-0000-4000-8000-000000000001';
    const call = (path: string, token: string) => request(app.getHttpServer()).get(path).query({ stepId: missingStep }).set(bearer(token));

    // read Company: the administrator (manage all) and the requester (catalog read) have it.
    await call('/test/companies', adminToken).expect(200);
    await call('/test/companies', requesterToken).expect(200);
    // update Workflow: only the administrator.
    await call('/test/invalid-step-change', adminToken).expect(200);
    await call('/test/invalid-step-change', requesterToken).expect(403);
  });
});
