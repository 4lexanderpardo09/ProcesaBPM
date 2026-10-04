import { randomUUID } from 'node:crypto';
import { connectTestDatabase, type TestDatabase, withContext } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATASET_READERS } from '../../src/modules/data-exports/data/dataset-readers/index.js';
import {
  EXPORT_DATASETS,
  EXPORT_EXCLUDED_COLUMNS,
  EXPORT_EXCLUDED_TABLES,
  SENSITIVE_COLUMN_NAME,
  SENSITIVE_NAMES_ALLOWED,
} from '../../src/modules/data-exports/domain/export-datasets.js';

/**
 * The export's allow-list against the real schema (mandatory guard, docs/base-de-datos.md §11): a new table with
 * tenant_id, or a new column of an exported table, fails here until someone decides whether it leaves with the
 * organization's data. Secrets never do.
 */
describe('organization data export: coverage of the schema', () => {
  let db: TestDatabase;
  let columnsByTable: Map<string, string[]>;
  let tenantTables: string[];

  const exportedColumns = (table: string): Set<string> => new Set(EXPORT_DATASETS.flatMap((dataset) => [...((dataset.sources as Record<string, readonly string[]>)[table] ?? [])]));
  const sourceTables = (): Set<string> => new Set(EXPORT_DATASETS.flatMap((dataset) => Object.keys(dataset.sources)));

  beforeAll(async () => {
    db = connectTestDatabase();
    const { rows } = await db.owner.query<{ table_name: string; column_name: string }>(`
      SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' ORDER BY c.table_name, c.ordinal_position`);
    columnsByTable = new Map();
    for (const row of rows) columnsByTable.set(row.table_name, [...(columnsByTable.get(row.table_name) ?? []), row.column_name]);
    tenantTables = [...columnsByTable].filter(([, columns]) => columns.includes('tenant_id')).map(([table]) => table);
  });

  afterAll(async () => {
    await db.close();
  });

  it('classifies every table with tenant_id: exported or excluded with a reason, never both', () => {
    const exported = sourceTables();
    expect(tenantTables.filter((table) => !exported.has(table) && EXPORT_EXCLUDED_TABLES[table] === undefined)).toEqual([]);
    expect(Object.keys(EXPORT_EXCLUDED_TABLES).filter((table) => exported.has(table))).toEqual([]);
    expect(Object.keys(EXPORT_EXCLUDED_TABLES).filter((table) => !tenantTables.includes(table))).toEqual([]);
    expect(Object.values(EXPORT_EXCLUDED_TABLES).every((reason) => reason.length > 10)).toBe(true);
  });

  it('reads only columns that exist', () => {
    const missing = [...sourceTables()].flatMap((table) => [...exportedColumns(table)].filter((column) => !(columnsByTable.get(table) ?? []).includes(column)).map((column) => `${table}.${column}`));
    expect(missing).toEqual([]);
  });

  it('classifies every column of every table it reads: exported or excluded with a reason, never both', () => {
    const unclassified: string[] = [];
    const contradictory: string[] = [];
    for (const table of sourceTables()) {
      const exported = exportedColumns(table);
      const excluded = EXPORT_EXCLUDED_COLUMNS[table] ?? {};
      for (const column of columnsByTable.get(table) ?? []) if (!exported.has(column) && excluded[column] === undefined) unclassified.push(`${table}.${column}`);
      for (const column of Object.keys(excluded)) if (exported.has(column) || !(columnsByTable.get(table) ?? []).includes(column)) contradictory.push(`${table}.${column}`);
    }
    expect(unclassified).toEqual([]);
    expect(contradictory).toEqual([]);
    expect(Object.keys(EXPORT_EXCLUDED_COLUMNS).filter((table) => !sourceTables().has(table))).toEqual([]);
  });

  it('exports no column whose name suggests a secret, unless it is allowed with a reason', () => {
    const suspicious = [
      ...[...sourceTables()].flatMap((table) => [...exportedColumns(table)].map((column) => `${table}.${column}`)),
      ...EXPORT_DATASETS.flatMap((dataset) => dataset.columns.map((column) => `${dataset.name}.${column}`)),
    ].filter((name) => SENSITIVE_COLUMN_NAME.test(name.split('.')[1]!) && SENSITIVE_NAMES_ALLOWED[name] === undefined);
    expect([...new Set(suspicious)]).toEqual([]);
    for (const name of Object.keys(SENSITIVE_NAMES_ALLOWED)) expect(exportedColumns(name.split('.')[0]!).has(name.split('.')[1]!)).toBe(true);
  });

  it('never reads a secret, even encrypted', () => {
    const secrets = ['users.password_hash', 'users.mfa_secret_encrypted', 'webhooks.secret_encrypted', 'user_mfa_backup_codes.code_hash', 'refresh_sessions.token_hash', 'user_tokens.token_hash'];
    expect(secrets.filter((name) => exportedColumns(name.split('.')[0]!).has(name.split('.')[1]!))).toEqual([]);
    expect([...sourceTables()].filter((table) => ['user_mfa_backup_codes', 'refresh_sessions', 'user_tokens', 'webhooks', 'consumed_auth_tokens'].includes(table))).toEqual([]);
  });

  it('each reader returns exactly the declared columns, in order, as the worker role with the tenant in context', async () => {
    const tenantId = randomUUID();
    const mismatches: string[] = [];
    await withContext(db.worker, { tenantId }, async (client) => {
      for (const dataset of EXPORT_DATASETS) {
        const reader = DATASET_READERS[dataset.name];
        const query = reader.page(tenantId, reader.start, 0);
        const result = await client.query(query.text, query.values as unknown[]);
        const fields = result.fields.map((field) => field.name);
        if (JSON.stringify(fields) !== JSON.stringify(dataset.columns)) mismatches.push(`${dataset.name}: ${fields.join(',')}`);
        expect(reader.start).toHaveLength(dataset.key.length);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it('pages each single-table dataset by its primary key (without tenant_id)', async () => {
    const { rows } = await db.owner.query<{ table_name: string; key: string[] }>(`
      SELECT c.relname AS table_name, array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) AS key
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
      WHERE i.indisprimary AND c.relnamespace = 'public'::regnamespace GROUP BY c.relname`);
    const primaryKeys = new Map(rows.map((row) => [row.table_name, row.key.filter((column) => column !== 'tenant_id')]));
    const wrong = EXPORT_DATASETS.filter((dataset) => primaryKeys.has(dataset.name) && JSON.stringify(primaryKeys.get(dataset.name)) !== JSON.stringify(dataset.key)).map((dataset) => dataset.name);
    expect(wrong).toEqual([]);
  });
});
