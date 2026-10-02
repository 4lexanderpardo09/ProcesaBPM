import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../src/seed/role-templates.js';
import { connectTestDatabase, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, type SeededTenant } from './support/fixtures.js';

const MIGRATION = readFileSync(new URL('../prisma/migrations/20261013000100_agent_report_scope/migration.sql', import.meta.url), 'utf8');
const CONDITION = { departmentId: '${membership.departmentId}' };

describe('the base agent role sees the reports of its own department', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let reportId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    reportId = (await db.platform.query<{ id: string }>(`SELECT id FROM permissions WHERE action = 'read' AND subject = 'Report'`)).rows[0]!.id;
  });
  afterAll(async () => {
    await db.close();
  });

  const role = async (systemRole: string | null, conditions: unknown) => {
    const id = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, system_role) VALUES ($1, $2, $3::system_role) RETURNING id`, [tenant.tenantId, randomUUID(), systemRole]);
    await db.platform.query(`INSERT INTO role_permissions (tenant_id, role_id, permission_id, conditions) VALUES ($1, $2, $3, $4::jsonb)`, [tenant.tenantId, id, reportId, conditions === null ? null : JSON.stringify(conditions)]);
    return id;
  };
  const conditionsOf = async (roleId: string) => (await db.platform.query<{ conditions: unknown }>(`SELECT conditions FROM role_permissions WHERE tenant_id = $1 AND role_id = $2`, [tenant.tenantId, roleId])).rows[0]!.conditions;

  it('the template grants it with the department condition, and only that permission is limited', () => {
    const agent = ROLE_TEMPLATES.find((template) => template.systemRole === 'AGENT')!;
    expect(agent.permissions.filter((permission) => permission.conditions !== undefined)).toEqual([{ action: 'read', subject: 'Report', conditions: CONDITION }]);
    const supervisor = ROLE_TEMPLATES.find((template) => template.systemRole === 'SUPERVISOR')!;
    expect(supervisor.permissions.some((permission) => permission.conditions !== undefined)).toBe(false);
  });

  it('the migration limits the unconditional grant of existing agent roles and leaves everything else as it was', async () => {
    const agent = await role('AGENT', null);
    const alreadyLimited = await role('AGENT', { companyId: tenant.companyId });
    const supervisor = await role('SUPERVISOR', null);
    const custom = await role(null, null);
    await db.platform.query(MIGRATION);
    expect(await conditionsOf(agent)).toEqual(CONDITION);
    expect(await conditionsOf(alreadyLimited)).toEqual({ companyId: tenant.companyId });
    expect(await conditionsOf(supervisor)).toBeNull();
    expect(await conditionsOf(custom)).toBeNull();
  });
});
