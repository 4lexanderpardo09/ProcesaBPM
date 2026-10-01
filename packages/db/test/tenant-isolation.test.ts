import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, seedTicket, type SeededTenant, type SeededTicket } from './support/fixtures.js';

const GLOBAL_TABLES = new Set([
  'countries',
  'currencies',
  'country_holidays',
  'permissions',
  'plans',
  'platform_admins',
  'platform_event_types',
  'platform_audit_logs',
  'platform_outbox_events',
  'platform_announcements',
]);

describe('tenant isolation (row-level security)', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let ticketA: SeededTicket;
  let ticketB: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenantA = await seedTenant(db.platform, 'a');
    tenantB = await seedTenant(db.platform, 'b');
    ticketA = await seedTicket(db.platform, tenantA);
    ticketB = await seedTicket(db.platform, tenantB);
  });

  afterAll(async () => {
    await db.close();
  });

  it('forces RLS with a tenant policy on every table that has tenant_id', async () => {
    const { rows } = await db.owner.query<{ table_name: string; forced: boolean; has_policy: boolean }>(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AND c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS has_policy
      FROM pg_class c
      JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'tenant_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    `);

    expect(rows.length).toBeGreaterThan(70);
    const unprotected = rows.filter((row) => !row.forced || !row.has_policy).map((row) => row.table_name);
    expect(unprotected).toEqual([]);
  });

  it('forces RLS on every non-catalog table, including tenants and users', async () => {
    const { rows } = await db.owner.query<{ relname: string }>(`
      SELECT relname FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
        AND NOT (relrowsecurity AND relforcerowsecurity)
    `);

    const unprotected = rows.map((row) => row.relname).filter((name) => !GLOBAL_TABLES.has(name));
    expect(unprotected).toEqual([]);
  });

  it('only returns the current tenant rows', async () => {
    const ticketIds = await withContext(db.runtime, { tenantId: tenantA.tenantId }, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM tickets');
      return rows.map((row) => row.id);
    });

    expect(ticketIds).toContain(ticketA.ticketId);
    expect(ticketIds).not.toContain(ticketB.ticketId);
  });

  it('returns nothing when no tenant is set in the request context', async () => {
    const count = await withoutContext(db.runtime, async (client) => {
      const { rows } = await client.query<{ count: string }>('SELECT count(*) FROM tickets');
      return Number(rows[0]?.count);
    });

    expect(count).toBe(0);
  });

  it('does not let a request update or delete another tenant rows', async () => {
    const affected = await withContext(db.runtime, { tenantId: tenantA.tenantId }, async (client) => {
      const updated = await client.query('UPDATE tickets SET title = $1 WHERE id = $2', ['hijacked', ticketB.ticketId]);
      const deleted = await client.query('DELETE FROM tickets WHERE id = $1', [ticketB.ticketId]);
      return (updated.rowCount ?? 0) + (deleted.rowCount ?? 0);
    });

    expect(affected).toBe(0);
    const { rows } = await db.platform.query<{ title: string }>('SELECT title FROM tickets WHERE id = $1', [ticketB.ticketId]);
    expect(rows[0]?.title).toBe('Test ticket');
  });

  it('rejects inserting a row for another tenant', async () => {
    const insertForeignRow = () => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) =>
      client.query(`INSERT INTO priorities (tenant_id, name) VALUES ($1, 'Urgent')`, [tenantB.tenantId]),
    );

    expect(await sqlStateOf(insertForeignRow)).toBe(SqlState.insufficientPrivilege);
  });

  it('does not leak the tenant setting to the next transaction on the same connection', async () => {
    const client = await db.runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA.tenantId]);
      await client.query('COMMIT');

      const { rows } = await client.query<{ count: string }>('SELECT count(*) FROM tickets');
      expect(Number(rows[0]?.count)).toBe(0);
    } finally {
      client.release();
    }
  });

  it('only shows users who are members of the current tenant', async () => {
    const userIds = await withContext(db.runtime, { tenantId: tenantA.tenantId }, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM users');
      return rows.map((row) => row.id);
    });

    expect(userIds).toContain(tenantA.userId);
    expect(userIds).not.toContain(tenantB.userId);
  });

  it('only exposes the current tenant row in the tenants table', async () => {
    const tenantIds = await withContext(db.runtime, { tenantId: tenantA.tenantId }, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM tenants');
      return rows.map((row) => row.id);
    });

    expect(tenantIds).toEqual([tenantA.tenantId]);
  });

  it('does not let the runtime role create tenants or touch platform admins', async () => {
    const createTenant = () => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) =>
      client.query(`INSERT INTO tenants (slug, name, plan_id, country_code, time_zone)
                    SELECT 'evil', 'Evil', id, 'CO', 'UTC' FROM plans LIMIT 1`),
    );
    const readAdmins = () => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) =>
      client.query('SELECT * FROM platform_admins'),
    );

    expect(await sqlStateOf(createTenant)).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(readAdmins)).toBe(SqlState.insufficientPrivilege);
  });
});
