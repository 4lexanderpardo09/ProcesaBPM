import { randomUUID } from 'node:crypto';
import { Prisma } from '@procesabpm/db';
import { connectTestDatabase, type TestDatabase, withContext } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATASET_READERS } from '../../src/modules/data-exports/data/dataset-readers/index.js';
import {
  EXPORT_DATASETS,
  type ExportDataset,
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

  /**
   * What a reader's SQL really reads: the table and column behind each output field, from the protocol's field metadata
   * (an expression or a cast has none). Compared with the declaration: the same output names in order, no expression,
   * and per table exactly the declared source columns.
   */
  async function readerViolations(client: pg.PoolClient, dataset: ExportDataset, query: Prisma.Sql): Promise<string[]> {
    const result = await client.query(query.text, query.values as unknown[]);
    const tableIds = [...new Set(result.fields.map((field) => field.tableID).filter((id) => id !== 0))];
    const { rows } = await client.query<{ table_id: number; column_id: number; table_name: string; column_name: string }>(
      `SELECT a.attrelid::int AS table_id, a.attnum::int AS column_id, c.relname AS table_name, a.attname AS column_name
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE a.attrelid = ANY ($1::oid[]) AND a.attnum > 0`,
      [tableIds],
    );
    const sourceOf = new Map(rows.map((row) => [`${row.table_id}:${row.column_id}`, `${row.table_name}.${row.column_name}`]));
    const violations: string[] = [];
    const names = result.fields.map((field) => field.name);
    if (JSON.stringify(names) !== JSON.stringify(dataset.columns)) violations.push(`${dataset.name}: outputs ${names.join(',')}`);
    const read = new Set<string>();
    for (const field of result.fields) {
      const source = sourceOf.get(`${field.tableID}:${field.columnID}`);
      if (source === undefined) violations.push(`${dataset.name}.${field.name}: an expression, not a column`);
      else read.add(source);
    }
    const declared = new Set(Object.entries(dataset.sources).flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`)));
    for (const source of read) if (!declared.has(source)) violations.push(`${dataset.name}: reads undeclared ${source}`);
    for (const source of declared) if (!read.has(source)) violations.push(`${dataset.name}: declares ${source} but does not read it`);
    return violations;
  }

  it('each reader reads exactly its declared source columns and outputs the declared columns, as the worker role', async () => {
    const tenantId = randomUUID();
    const violations: string[] = [];
    await withContext(db.worker, { tenantId }, async (client) => {
      for (const dataset of EXPORT_DATASETS) {
        const reader = DATASET_READERS[dataset.name];
        violations.push(...(await readerViolations(client, dataset, reader.page(tenantId, reader.start, 0))));
        expect(reader.start).toHaveLength(dataset.key.length);
      }
    });
    expect(violations).toEqual([]);
  });

  it('the check catches a reader that reads an undeclared column, plainly or under a declared name', async () => {
    const members = EXPORT_DATASETS.find((dataset) => dataset.name === 'members')!;
    const tenantId = randomUUID();
    const extraColumn = Prisma.sql`
      SELECT m.tenant_id, m.user_id, u.email, u.first_name, u.last_name, u.document_number, u.status AS account_status, u.locale,
             u.time_zone, m.role_id, m.position_id, m.department_id, m.site_id, m.status, m.is_owner, m.signature_file_id, m.joined_at,
             m.created_at, m.updated_at, u.last_login_at
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId}::uuid LIMIT 0`;
    const aliased = Prisma.sql`
      SELECT m.tenant_id, m.user_id, u.failed_logins AS email, u.first_name, u.last_name, u.document_number, u.status AS account_status,
             u.locale, u.time_zone, m.role_id, m.position_id, m.department_id, m.site_id, m.status, m.is_owner, m.signature_file_id,
             m.joined_at, m.created_at, m.updated_at
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId}::uuid LIMIT 0`;
    const casted = Prisma.sql`
      SELECT m.tenant_id, m.user_id, u.email, u.first_name, u.last_name, u.document_number, u.status::text AS account_status, u.locale,
             u.time_zone, m.role_id, m.position_id, m.department_id, m.site_id, m.status, m.is_owner, m.signature_file_id, m.joined_at,
             m.created_at, m.updated_at
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId}::uuid LIMIT 0`;
    // The owner, because the worker role cannot even read those columns: here only the check is under test.
    await withContext(db.owner, { tenantId }, async (client) => {
      expect(await readerViolations(client, members, extraColumn)).toEqual(expect.arrayContaining(['members: reads undeclared users.last_login_at']));
      expect(await readerViolations(client, members, aliased)).toEqual(expect.arrayContaining(['members: reads undeclared users.failed_logins', 'members: declares users.email but does not read it']));
      expect(await readerViolations(client, members, casted)).toEqual(expect.arrayContaining(['members.account_status: an expression, not a column']));
    });
  });

  it('declares the format of every date and time column it reads', async () => {
    const { rows } = await db.owner.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('date', 'time without time zone', 'time with time zone')`,
    );
    const missing = rows.flatMap((row) =>
      EXPORT_DATASETS.filter((dataset) => (dataset.sources as Record<string, readonly string[]>)[row.table_name]?.includes(row.column_name) && dataset.formats?.[row.column_name] === undefined).map((dataset) => `${dataset.name}.${row.column_name}`),
    );
    expect(missing).toEqual([]);
  });

  it('every reader filters the tenant itself: run with RLS bypassed, it returns only the given tenant\'s rows', async () => {
    const [first, second] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    const leaks: string[] = [];
    let rowsOfFirst = 0;
    // app_platform has BYPASSRLS: only the readers' own tenant_id filter separates the tenants here.
    await withContext(db.platform, {}, async (client) => {
      for (const dataset of EXPORT_DATASETS) {
        const reader = DATASET_READERS[dataset.name];
        const query = reader.page(first.tenantId, reader.start, 100_000);
        const { rows } = await client.query<Record<string, unknown>>(query.text, query.values as unknown[]);
        const column = dataset.name === 'tenants' ? 'id' : 'tenant_id';
        rowsOfFirst += rows.length;
        if (rows.some((row) => row[column] !== first.tenantId)) leaks.push(dataset.name);
      }
    });
    expect(leaks).toEqual([]);
    expect(rowsOfFirst).toBeGreaterThan(0);
    // The other tenant has rows in the same tables, so a missing filter would have shown.
    const { rows } = await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1', [second.tenantId]);
    expect(rows[0]!.n).toBeGreaterThan(0);
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
