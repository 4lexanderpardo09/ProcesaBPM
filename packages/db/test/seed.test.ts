import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, PLANS } from '../src/seed/catalog.js';
import { ROLE_TEMPLATES } from '../src/seed/role-templates.js';
import { seedGlobalCatalog } from '../src/seed/seed-global-catalog.js';
import { connectTestDatabase, withoutContext, type TestDatabase } from './support/database.js';

describe('global catalog seed', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  const count = async (table: string) => {
    const { rows } = await db.owner.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    return Number(rows[0]?.count);
  };

  it('is idempotent and runs with the platform role', async () => {
    const before = { permissions: await count('permissions'), holidays: await count('country_holidays') };

    await withoutContext(db.platform, (client) => seedGlobalCatalog(client, { holidayYears: [2026, 2027] }));

    expect({ permissions: await count('permissions'), holidays: await count('country_holidays') }).toEqual(before);
  });

  it('does not undo plan limits edited from the platform console', async () => {
    await db.owner.query(`UPDATE plans SET max_users = 77 WHERE code = 'basic'`);
    try {
      await withoutContext(db.platform, (client) => seedGlobalCatalog(client, { holidayYears: [2026] }));
      const { rows } = await db.owner.query<{ max_users: number }>(`SELECT max_users FROM plans WHERE code = 'basic'`);
      expect(rows[0]?.max_users).toBe(77);
    } finally {
      await db.owner.query(`UPDATE plans SET max_users = NULL WHERE code = 'basic'`);
    }
  });

  it('loads the approved plans and the whole permission catalog', async () => {
    expect(await count('plans')).toBe(PLANS.length);
    expect(await count('permissions')).toBe(PERMISSIONS.length);
    expect(await count("country_holidays WHERE country_code = 'CO' AND extract(year FROM date) = 2026")).toBe(19);
  });

  it('stores the professional plan storage as base + per-user bytes', async () => {
    const { rows } = await db.owner.query<{ base: string; per_user: string }>(
      `SELECT storage_base_bytes AS base, storage_per_user_bytes AS per_user FROM plans WHERE code = 'professional'`,
    );

    expect(rows[0]).toEqual({ base: String(25 * 1024 ** 3), per_user: String(2 * 1024 ** 3) });
  });
});

describe('permission catalog and role templates', () => {
  const key = (permission: { action: string; subject: string }) => `${permission.action}:${permission.subject}`;

  it('has no duplicated permissions', () => {
    const keys = PERMISSIONS.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only grants permissions that exist in the catalog', () => {
    const catalog = new Set(PERMISSIONS.map(key));
    const unknown = ROLE_TEMPLATES.flatMap((role) => role.permissions.map(key)).filter((permission) => !catalog.has(permission));

    expect(unknown).toEqual([]);
  });

  it('defines exactly one administrator template', () => {
    expect(ROLE_TEMPLATES.filter((role) => role.isAdmin).map((role) => role.systemRole)).toEqual(['ADMIN']);
  });
});
