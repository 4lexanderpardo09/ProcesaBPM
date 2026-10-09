import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('purge reminders (B17)', () => {
  let db: TestDatabase;
  let requesterId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    requesterId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Op', 'Erator') RETURNING id`, [`operator-${randomUUID()}@example.com`]);
    await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [requesterId]);
  });
  afterAll(() => db.close());

  /** A tenant pending deletion whose purge is `left` away (a Postgres interval), with its seeded member as the owner. */
  async function pendingWith(left: string, owner = true): Promise<SeededTenant> {
    const tenant = await seedTenant(db.platform);
    if (owner) await db.owner.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
    await db.owner.query(
      `UPDATE tenants SET status = 'PENDING_DELETION', deletion_requested_at = now(), deletion_requested_by_id = $2, purge_after = now() + $3::interval WHERE id = $1`,
      [tenant.tenantId, requesterId, left],
    );
    return tenant;
  }
  const moveTo = (tenant: SeededTenant, left: string) => db.owner.query('UPDATE tenants SET purge_after = now() + $2::interval WHERE id = $1', [tenant.tenantId, left]);
  const run = () => withoutContext(db.worker, async (client) => (await client.query<{ n: number }>('SELECT enqueue_due_purge_reminders(100) AS n')).rows[0]!.n);
  const reminders = async (tenant: SeededTenant) =>
    (await db.owner.query<{ payload: { tenantId: string; userId: string; daysLeft: number } }>(`SELECT payload FROM platform_outbox_events WHERE type = 'email.tenant_purge_reminder' AND payload ->> 'tenantId' = $1 ORDER BY created_at, id`, [tenant.tenantId])).rows.map((row) => row.payload);
  const level = async (tenant: SeededTenant) => (await db.owner.query<{ purge_reminder_level: number }>('SELECT purge_reminder_level FROM tenants WHERE id = $1', [tenant.tenantId])).rows[0]!.purge_reminder_level;

  it('sends the 7-day reminder once, then the 1-day one once', async () => {
    const tenant = await pendingWith('10 days');
    await run();
    expect(await reminders(tenant)).toEqual([]);
    await moveTo(tenant, '6 days');
    await run();
    await run();
    expect(await reminders(tenant)).toEqual([{ tenantId: tenant.tenantId, userId: tenant.userId, daysLeft: 7 }]);
    expect(await level(tenant)).toBe(1);
    await moveTo(tenant, '12 hours');
    await run();
    await run();
    expect((await reminders(tenant)).map((payload) => payload.daysLeft)).toEqual([7, 1]);
    expect(await level(tenant)).toBe(2);
  });

  it('a worker that was down past the 7-day mark sends only the 1-day reminder', async () => {
    const tenant = await pendingWith('12 hours');
    await run();
    expect((await reminders(tenant)).map((payload) => payload.daysLeft)).toEqual([1]);
  });

  it('nothing once the period is over, for a tenant that is not pending, nor without an active owner (the level still moves)', async () => {
    const over = await pendingWith('-1 hour');
    const active = await seedTenant(db.platform);
    const ownerless = await pendingWith('3 days', false);
    await run();
    expect(await reminders(over)).toEqual([]);
    expect(await reminders(active)).toEqual([]);
    expect(await reminders(ownerless)).toEqual([]);
    expect(await level(ownerless)).toBe(1);
  });

  it('the level only lives while the deletion is pending: cancelling must reset it', async () => {
    const tenant = await pendingWith('3 days');
    await run();
    const cancel = (extra: string) =>
      db.owner.query(`UPDATE tenants SET status = 'SUSPENDED', deletion_requested_at = NULL, deletion_requested_by_id = NULL, purge_after = NULL${extra} WHERE id = $1`, [tenant.tenantId]);
    expect(await sqlStateOf(() => cancel(''))).toBe(SqlState.checkViolation);
    await cancel(', purge_reminder_level = 0');
    expect(await sqlStateOf(() => db.owner.query('UPDATE tenants SET purge_reminder_level = 1 WHERE id = $1', [tenant.tenantId]))).toBe(SqlState.checkViolation);
  });

  it('only the worker queues reminders, and only through its function', async () => {
    const tenant = await pendingWith('3 days');
    const asRuntime = (sql: string, params: unknown[]) => sqlStateOf(() => withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) => client.query(sql, params)));
    expect(await asRuntime('SELECT enqueue_due_purge_reminders(100)', [])).toBe(SqlState.insufficientPrivilege);
    expect(await asRuntime('SELECT enqueue_tenant_purge_reminder($1, $2, 7)', [tenant.tenantId, tenant.userId])).toBe(SqlState.insufficientPrivilege);
    expect(await asRuntime(`SELECT enqueue_platform_event('email.tenant_purge_reminder', $1::jsonb)`, [JSON.stringify({ tenantId: tenant.tenantId, userId: tenant.userId, daysLeft: 1 })])).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(() => withoutContext(db.worker, (client) => client.query('SELECT enqueue_tenant_purge_reminder($1, $2, 7)', [tenant.tenantId, tenant.userId])))).toBe(SqlState.insufficientPrivilege);
    expect(await reminders(tenant)).toEqual([]);
  });
});
