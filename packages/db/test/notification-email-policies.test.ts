import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

describe('e-mail policy of notifications, per organization and type (§8.35)', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });
  afterAll(() => db.close());

  const save = (tenantId: string, type: string, policy: string) =>
    withContext(db.runtime, { tenantId }, (client) =>
      client.query(
        `INSERT INTO notification_email_policies (tenant_id, type, policy) VALUES ($1, $2::notification_type, $3::notification_email_policy)
         ON CONFLICT (tenant_id, type) DO UPDATE SET policy = EXCLUDED.policy`,
        [tenantId, type, policy],
      ),
    );
  const policiesOf = (pool: TestDatabase['runtime'], tenantId: string) =>
    withContext(pool, { tenantId }, async (client) => (await client.query<{ tenant_id: string; type: string; policy: string }>('SELECT tenant_id, type, policy FROM notification_email_policies ORDER BY type')).rows);

  it('keeps one policy per type, changed in place with its date', async () => {
    await save(tenant.tenantId, 'TICKET_CREATED', 'DEFAULT_ON');
    const before = (await db.owner.query<{ updated_at: Date }>('SELECT updated_at FROM notification_email_policies WHERE tenant_id = $1', [tenant.tenantId])).rows[0]!.updated_at;
    await save(tenant.tenantId, 'TICKET_CREATED', 'OFF');
    const rows = (await db.owner.query<{ policy: string; updated_at: Date }>('SELECT policy, updated_at FROM notification_email_policies WHERE tenant_id = $1', [tenant.tenantId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.policy).toBe('OFF');
    expect(rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('refuses a policy that does not exist', async () => {
    expect(await sqlStateOf(() => save(tenant.tenantId, 'TICKET_CLOSED', 'SOMETIMES'))).toBe('22P02');
  });

  it('shows each organization only its own policies, to the API and to the worker, and never writes into another', async () => {
    await save(other.tenantId, 'TICKET_COMMENTED', 'DEFAULT_ON');
    for (const pool of [db.runtime, db.worker]) {
      expect((await policiesOf(pool, tenant.tenantId)).map((row) => row.tenant_id)).toEqual([tenant.tenantId]);
      expect(await policiesOf(pool, other.tenantId)).toEqual([{ tenant_id: other.tenantId, type: 'TICKET_COMMENTED', policy: 'DEFAULT_ON' }]);
    }
    const intoOther = () =>
      withContext(db.runtime, { tenantId: tenant.tenantId }, (client) => client.query(`INSERT INTO notification_email_policies (tenant_id, type, policy) VALUES ($1, 'SYSTEM', 'OFF')`, [other.tenantId]));
    expect(await sqlStateOf(intoOther)).toBe(SqlState.insufficientPrivilege);
  });

  it('goes away with its organization', async () => {
    const leaving = await seedTenant(db.platform);
    await save(leaving.tenantId, 'SLA_OVERDUE', 'OFF');
    await db.owner.query('DELETE FROM tenants WHERE id = $1', [leaving.tenantId]);
    expect((await db.owner.query('SELECT 1 FROM notification_email_policies WHERE tenant_id = $1', [leaving.tenantId])).rowCount).toBe(0);
  });
});
