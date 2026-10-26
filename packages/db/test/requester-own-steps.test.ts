import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_TEMPLATES } from '../src/seed/role-templates.js';
import { connectTestDatabase } from './support/database.js';
import { insertReturningId, seedTenant } from './support/fixtures.js';

const MIGRATION = readFileSync(new URL('../prisma/migrations/20261028000000_requester_answers_own_steps/migration.sql', import.meta.url), 'utf8');
const GRANTS = ['close', 'read_assigned', 'transition'];

describe('the base requester answers the steps handed back to them', () => {
  it('the template has the grants, and the migration gives them to existing requester roles once and to no other role', async () => {
    const template = ROLE_TEMPLATES.find((candidate) => candidate.systemRole === 'REQUESTER')!;
    for (const action of GRANTS) expect(template.permissions).toContainEqual({ action, subject: 'Ticket' });

    const db = connectTestDatabase();
    try {
      const tenant = await seedTenant(db.platform);
      const role = (systemRole: string | null) => insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, system_role) VALUES ($1, $2, $3) RETURNING id`, [tenant.tenantId, randomUUID(), systemRole]);
      const requester = await role('REQUESTER');
      const custom = await role(null);
      const grants = async (roleId: string) =>
        (await db.platform.query<{ action: string }>(`SELECT p.action FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.tenant_id = $1 AND rp.role_id = $2 AND p.subject = 'Ticket' ORDER BY p.action`, [tenant.tenantId, roleId])).rows.map((row) => row.action);
      await db.platform.query(MIGRATION);
      await db.platform.query(MIGRATION);
      expect(await grants(requester)).toEqual(GRANTS);
      expect(await grants(custom)).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
