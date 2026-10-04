import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { seedUser, type TestUser } from './auth-fixtures.js';
import { bearer } from './auth-helpers.js';
import { grantEverything, seedRole } from './permission-fixtures.js';

export interface DeletedOrganization {
  readonly tenant: SeededTenant;
  readonly owner: TestUser;
  /** A member of the admin role who is not the owner. */
  readonly admin: TestUser;
  /** A member without full access. */
  readonly agent: TestUser;
}

/** An organization with an owner, an administrator and an agent, whose deletion the platform has just requested. */
export async function deletedOrganization(app: INestApplication, db: TestDatabase, platformToken: string): Promise<DeletedOrganization> {
  const tenant = await seedTenant(db.platform);
  await grantEverything(db, tenant);
  const owner = await seedUser(db, tenant);
  await db.owner.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, owner.userId]);
  const admin = await seedUser(db, tenant);
  const agent = await seedUser(db, tenant, undefined, { roleId: await seedRole(db, tenant.tenantId, 'Agent') });
  const { name } = (await db.owner.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenant.tenantId])).rows[0]!;
  await request(app.getHttpServer())
    .post(`/platform/tenants/${tenant.tenantId}/deletion`)
    .set(bearer(platformToken))
    .send({ confirmName: name, reason: 'Customer asked to leave' })
    .expect(200);
  return { tenant, owner, admin, agent };
}
