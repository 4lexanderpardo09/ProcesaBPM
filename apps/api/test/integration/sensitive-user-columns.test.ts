import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENSITIVE_USER_COLUMNS } from '../../src/infrastructure/database/prisma.service.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

/** Prisma field name → database column. */
const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

describe('SENSITIVE_USER_COLUMNS', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists exactly the users columns the application login cannot read (a new column must be listed, or every tenant query on users fails)', async () => {
    const { rows } = await db.owner.query<{ column_name: string }>(`
      SELECT a.attname AS column_name FROM pg_attribute a
      WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT has_column_privilege('app_runtime', 'public.users', a.attname, 'SELECT')
      ORDER BY 1`);

    expect(rows.map((row) => row.column_name)).toEqual(Object.keys(SENSITIVE_USER_COLUMNS).map(snakeCase).sort());
  });
});
