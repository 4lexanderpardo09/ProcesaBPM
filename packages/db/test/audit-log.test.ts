import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

describe('audit log', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  const asMember = <T>(who: SeededTenant, work: Parameters<typeof withContext<T>>[2], pool = db.runtime) =>
    withContext(pool, { tenantId: who.tenantId, userId: who.userId }, work);
  const insert = (who: SeededTenant, fields: { action?: string; entityType?: string; before?: unknown; userAgent?: string; requestId?: string; tenantId?: string; actorId?: string | null } = {}) =>
    asMember(who, (client) =>
      client.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, before, user_agent, request_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [fields.tenantId ?? who.tenantId, fields.actorId === undefined ? who.userId : fields.actorId, fields.action ?? 'role.created', fields.entityType ?? 'Role', fields.before === undefined ? null : JSON.stringify(fields.before), fields.userAgent ?? null, fields.requestId ?? null],
      ),
    );

  it('lets a member of the tenant append rows, stamped by the database clock', async () => {
    await insert(tenant, { action: 'role.permissions_replaced', requestId: 'req-1', userAgent: 'vitest' });
    const { rows } = await asMember(tenant, (client) => client.query<{ created_at: Date; request_id: string }>('SELECT created_at, request_id FROM audit_logs ORDER BY created_at DESC LIMIT 1'));
    expect(rows[0]?.request_id).toBe('req-1');
    expect(Math.abs(rows[0]!.created_at.getTime() - Date.now())).toBeLessThan(60_000);
  });

  describe('database clock (trigger audit_logs_database_clock)', () => {
    /** Inserts two rows dated by the caller, one in the purge window and one in the future, and tells whether both got now(). */
    const insertDated = (client: Parameters<Parameters<typeof withContext>[2]>[0], who: SeededTenant, actorId: string | null) =>
      client.query<{ dated_now: boolean; inserted: number }>(
        `WITH inserted AS (
           INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, created_at)
           VALUES ($1, $2, 'role.updated', 'Role', now() - interval '3 years'), ($1, $2, 'role.updated', 'Role', now() + interval '1 year')
           RETURNING created_at)
         SELECT bool_and(abs(extract(epoch FROM created_at - now())) < 0.001) AS dated_now, count(*)::int AS inserted FROM inserted`,
        [who.tenantId, actorId],
      );

    it.each(['runtime', 'worker'] as const)('dates every row written by the %s login with now(), whatever date it sends', async (login) => {
      const { rows } = await asMember(tenant, (client) => insertDated(client, tenant, tenant.userId), db[login]);
      expect(rows[0]).toEqual({ dated_now: true, inserted: 2 });
    });

    it('also dates the rows of the platform login (support and MFA reset rows), which bypasses RLS', async () => {
      const { rows } = await withContext(db.platform, {}, (client) => insertDated(client, tenant, null));
      expect(rows[0]).toEqual({ dated_now: true, inserted: 2 });
    });

    it('lets nobody but the schema owner change a date afterwards (the trail stays append-only)', async () => {
      for (const pool of [db.runtime, db.worker, db.platform]) {
        expect(await sqlStateOf(() => asMember(tenant, (client) => client.query(`UPDATE audit_logs SET created_at = now() - interval '3 years'`), pool))).toBe(SqlState.insufficientPrivilege);
      }
    });
  });

  it('refuses a row of another tenant (RLS WITH CHECK)', async () => {
    expect(await sqlStateOf(() => insert(tenant, { tenantId: other.tenantId }))).toBe(SqlState.insufficientPrivilege);
  });

  it('tenant leak: a tenant never reads another tenant’s rows', async () => {
    await insert(other, { action: 'role.deleted' });
    const seen = await asMember(tenant, async (client) => (await client.query<{ tenant_id: string }>('SELECT DISTINCT tenant_id FROM audit_logs')).rows.map((row) => row.tenant_id));
    expect(seen).toEqual([tenant.tenantId]);
  });

  it('the actor must be a member of that tenant', async () => {
    expect(await sqlStateOf(() => insert(tenant, { actorId: other.userId }))).toBe(SqlState.foreignKeyViolation);
  });

  it.each([
    ['an action without a verb', { action: 'role' }],
    ['an action in upper case', { action: 'Role.Created' }],
    ['an entity type with a space', { entityType: 'Role X' }],
    ['a summary above 8 KiB', { before: { text: 'x'.repeat(9000) } }],
    ['a user agent above 512 characters', { userAgent: 'u'.repeat(513) }],
    ['a request id above 64 characters', { requestId: 'r'.repeat(65) }],
  ])('refuses %s', async (_label, fields) => {
    expect(await sqlStateOf(() => insert(tenant, fields))).toBe(SqlState.checkViolation);
  });

  describe('append-only', () => {
    it.each([
      ['app_runtime', () => db.runtime],
      ['app_worker', () => db.worker],
      ['app_platform', () => db.platform],
    ])('%s cannot update, delete or truncate', async (_role, pool) => {
      await insert(tenant);
      const run = (sql: string) => sqlStateOf(() => withContext(pool(), { tenantId: tenant.tenantId, userId: tenant.userId }, (client) => client.query(sql)));
      expect(await run(`UPDATE audit_logs SET action = 'role.hacked'`)).toBe(SqlState.insufficientPrivilege);
      expect(await run('DELETE FROM audit_logs')).toBe(SqlState.insufficientPrivilege);
      expect(await run('TRUNCATE audit_logs')).toBe(SqlState.insufficientPrivilege);
    });
  });
});
