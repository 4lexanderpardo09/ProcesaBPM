import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant, withPlatformTransaction } from './support/fixtures.js';

describe('site tree rules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const name = () => `site-${Math.random().toString(36).slice(2, 9)}`;
  const insertSite = async (parentId: string | null, level: number, label = name(), tenantId = tenant.tenantId) =>
    (await db.platform.query<{ id: string }>(`INSERT INTO sites (tenant_id, parent_id, level, name) VALUES ($1, $2, $3, $4) RETURNING id`, [tenantId, parentId, level, label])).rows[0]!.id;
  const inTransaction = (statements: Array<[string, unknown[]]>) =>
    sqlStateOf(() =>
      withPlatformTransaction(db.platform, async (tx) => {
        for (const [sql, params] of statements) await tx.query(sql, params);
      }),
    );

  it('a root site is level 1 and a child is one level below its parent', async () => {
    const root = await insertSite(null, 1);
    const child = await insertSite(root, 2);
    await insertSite(child, 3);
  });

  it('a root with another level, or a child on level 1, is refused at once', async () => {
    expect(await sqlStateOf(() => insertSite(null, 2))).toBe(SqlState.checkViolation);
    const root = await insertSite(null, 1);
    expect(await sqlStateOf(() => insertSite(root, 1))).toBe(SqlState.checkViolation);
  });

  it('a child on the wrong level fails at commit', async () => {
    const root = await insertSite(null, 1);
    expect(await sqlStateOf(() => insertSite(root, 3))).toBe(SqlState.checkViolation);
  });

  it('moving a whole subtree in one transaction commits', async () => {
    const a = await insertSite(null, 1);
    const b = await insertSite(a, 2);
    const c = await insertSite(b, 3);
    const other = await insertSite(null, 1);
    expect(
      await inTransaction([
        ['UPDATE sites SET parent_id = $2, level = 2 WHERE tenant_id = $1 AND id = $3', [tenant.tenantId, other, a]],
        ['UPDATE sites SET level = 3 WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, b]],
        ['UPDATE sites SET level = 4 WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, c]],
      ]),
    ).toBeUndefined();
  });

  it('changing only the level of a parent or of a child fails at commit', async () => {
    const root = await insertSite(null, 1);
    const child = await insertSite(root, 2);
    await insertSite(child, 3);
    expect(await inTransaction([['UPDATE sites SET level = 5 WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, child]]])).toBe(SqlState.checkViolation);
    const lone = await insertSite(root, 2);
    const grandchild = await insertSite(lone, 3);
    expect(await inTransaction([['UPDATE sites SET level = 6 WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, grandchild]]])).toBe(SqlState.checkViolation);
  });

  it('a cycle cannot be built, whatever levels are chosen', async () => {
    const x = await insertSite(null, 1);
    const y = await insertSite(x, 2);
    expect(
      await inTransaction([
        ['UPDATE sites SET parent_id = $2, level = 3 WHERE tenant_id = $1 AND id = $3', [tenant.tenantId, y, x]],
      ]),
    ).toBe(SqlState.checkViolation);
    expect(
      await inTransaction([
        ['UPDATE sites SET parent_id = $2, level = 2 WHERE tenant_id = $1 AND id = $3', [tenant.tenantId, y, x]],
        ['UPDATE sites SET parent_id = $2, level = 1 WHERE tenant_id = $1 AND id = $3', [tenant.tenantId, null, y]],
      ]),
    ).toBeUndefined();
  });

  it('the level cannot pass the maximum', async () => {
    const parent = await insertSite(null, 1);
    expect(await sqlStateOf(() => db.platform.query(`INSERT INTO sites (tenant_id, parent_id, level, name) VALUES ($1, $2, 21, 'deep')`, [tenant.tenantId, parent]))).toBe(SqlState.checkViolation);
  });

  it('the parent must belong to the same tenant', async () => {
    const other = await seedTenant(db.platform);
    const foreignRoot = await insertSite(null, 1, name(), other.tenantId);
    expect(await sqlStateOf(() => insertSite(foreignRoot, 2))).toBe(SqlState.foreignKeyViolation);
  });

  it('a name is unique among the children of a parent, and among roots', async () => {
    const label = name();
    await insertSite(null, 1, label);
    expect(await sqlStateOf(() => insertSite(null, 1, label))).toBe(SqlState.uniqueViolation);
    const parent = await insertSite(null, 1);
    await insertSite(parent, 2, label);
    expect(await sqlStateOf(() => insertSite(parent, 2, label))).toBe(SqlState.uniqueViolation);
  });

  it('two tenants can use the same root name', async () => {
    const other = await seedTenant(db.platform);
    const label = name();
    await insertSite(null, 1, label);
    await insertSite(null, 1, label, other.tenantId);
  });
});
