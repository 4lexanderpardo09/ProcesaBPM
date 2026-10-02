import { randomBytes } from 'node:crypto';
import { type TestDatabase, withContext } from '@procesabpm/db/testing/database';
import { insertReturningId, type SeededTenant, seedMember, withPlatformTransaction } from '@procesabpm/db/testing/fixtures';
import { sha256Hex } from '../../src/infrastructure/security/token-utils.js';
import { emailOf, setPassword, TEST_PASSWORD } from './auth-helpers.js';

export interface TestUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
}

/** An active member of the tenant with a known password. */
export async function seedUser(
  db: TestDatabase,
  tenant: SeededTenant,
  password = TEST_PASSWORD,
  options: { roleId?: string; departmentId?: string } = {},
): Promise<TestUser> {
  const userId = await seedMember(db.platform, tenant);
  await setPassword(db, userId, password);
  if (options.roleId !== undefined) {
    await db.platform.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [options.roleId, tenant.tenantId, userId]);
  }
  return { userId, email: await emailOf(db, userId), password };
}

/** Gives an existing user an ACTIVE membership in another tenant. */
export async function addMembership(db: TestDatabase, tenant: SeededTenant, userId: string): Promise<void> {
  await withPlatformTransaction(db.platform, async (tx) => {
    await tx.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
      tenant.tenantId,
      userId,
      tenant.roleId,
    ]);
    await tx.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [
      tenant.tenantId,
      userId,
      tenant.companyId,
    ]);
  });
}

/**
 * What the identity module will do (docs/base-de-datos.md §8.3): `invite_user`, an INVITED membership
 * and an INVITATION token, as the tenant admin. Returns the clear token that the e-mail would carry.
 */
export async function inviteUser(db: TestDatabase, tenant: SeededTenant, email: string): Promise<{ userId: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const userId = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, async (tx) => {
    const invited = await insertReturningId(tx, `SELECT invite_user($1, 'Invited', 'Person') AS id`, [email]);
    await tx.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'INVITED')
                    ON CONFLICT DO NOTHING`, [tenant.tenantId, invited, tenant.roleId]);
    await tx.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)
                    ON CONFLICT DO NOTHING`, [tenant.tenantId, invited, tenant.companyId]);
    return invited;
  });
  // Only provisioning (the platform login) issues invitation tokens: the API role cannot.
  await withContext(db.platform, { tenantId: tenant.tenantId, userId: tenant.userId }, (tx) =>
    tx.query(`SELECT auth_issue_user_token($1, 'INVITATION', $2, now() + interval '7 days', NULL)`, [userId, sha256Hex(token)]),
  );
  return { userId, token };
}

export async function userRow(db: TestDatabase, userId: string) {
  const { rows } = await db.platform.query<{ failed_logins: number; locked_until: Date | null; password_hash: string | null }>(
    'SELECT failed_logins, locked_until, password_hash FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]!;
}

export async function membershipStatus(db: TestDatabase, tenantId: string, userId: string): Promise<string | undefined> {
  const { rows } = await db.platform.query<{ status: string }>(
    'SELECT status FROM memberships WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  );
  return rows[0]?.status;
}
