import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';

/**
 * Guards for future migrations: they fail as soon as a new table or foreign key
 * breaks one of the schema conventions documented in docs/base-de-datos.md.
 */
describe('schema conventions', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  it('indexes every foreign key (tenant purge and joins depend on it)', async () => {
    const { rows } = await db.owner.query<{ fk: string }>(`
      WITH fk AS (
        SELECT c.conname, c.conrelid, c.conkey FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
      )
      SELECT conname AS fk FROM fk
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = fk.conrelid
          AND (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] @> fk.conkey
          AND (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] <@ fk.conkey
      )
    `);

    expect(rows.map((row) => row.fk)).toEqual([]);
  });

  it('includes tenant_id in every foreign key between tenant tables', async () => {
    const { rows } = await db.owner.query<{ fk: string }>(`
      SELECT c.conname AS fk
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
        AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'tenant_id'
        )
    `);

    expect(rows.map((row) => row.fk)).toEqual([]);
  });

  it('starts the primary key of every tenant table with tenant_id', async () => {
    const { rows } = await db.owner.query<{ table_name: string }>(`
      SELECT t.relname AS table_name
      FROM pg_class t
      JOIN pg_index i ON i.indrelid = t.oid AND i.indisprimary
      WHERE t.relnamespace = 'public'::regnamespace AND t.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
        AND (SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = i.indkey[0]) <> 'tenant_id'
    `);

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it('keeps updated_at maintained by a trigger wherever the column exists', async () => {
    const { rows } = await db.owner.query<{ table_name: string }>(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass AND tg.tgname = 'set_updated_at'
        )
    `);

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it('runs every SECURITY DEFINER function as a platform owner with search_path public, pg_temp', async () => {
    // app_platform owns the general ones; app_outbox_owner owns those that touch the platform outbox, so
    // that the BYPASSRLS login of app_platform cannot read the tokens in it; app_retention_owner owns only retention
    // functions. Temp tables cannot shadow real ones.
    const { rows } = await db.owner.query<{ fn: string }>(`
      SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
      WHERE p.prosecdef
        AND p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
        AND (p.pronamespace <> 'public'::regnamespace
             OR pg_get_userbyid(p.proowner) NOT IN ('app_platform', 'app_outbox_owner', 'app_retention_owner')
             OR (pg_get_userbyid(p.proowner) = 'app_retention_owner' AND p.proname NOT LIKE 'retention\\_%')
             OR NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false))
      ORDER BY 1
    `);

    expect(rows.map((row) => row.fn)).toEqual([]);
  });

  it('only app_outbox_owner owns the functions that touch the platform outbox', async () => {
    const { rows } = await db.owner.query<{ fn: string }>(`
      SELECT p.proname AS fn FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'app_outbox_owner'
      ORDER BY 1
    `);

    expect(rows.map((row) => row.fn)).toEqual([
      'claim_platform_outbox_events',
      'complete_platform_outbox_event',
      'enqueue_member_security_notice',
      'enqueue_platform_event',
      'enqueue_security_notice',
      'fail_platform_outbox_event',
      'list_failed_platform_outbox_events',
      'platform_outbox_claim_is_current',
      'retention_purge_platform_outbox_events',
      'retry_failed_platform_outbox_event',
    ]);
  });

  it('gives app_retention_owner only the trail purges, and on the trails only reading the columns it filters on and deleting', async () => {
    const { rows: functions } = await db.owner.query<{ fn: string }>(`
      SELECT p.proname AS fn FROM pg_proc p WHERE pg_get_userbyid(p.proowner) = 'app_retention_owner' ORDER BY 1`);
    expect(functions.map((row) => row.fn)).toEqual([
      'retention_purge_audit_logs',
      'retention_purge_platform_audit_logs',
      'retention_purge_support_access_grants',
      'retention_purge_support_sessions',
    ]);

    const { rows: tables } = await db.owner.query<{ grant: string }>(`
      SELECT c.relname || ' ' || p.privilege AS grant
      FROM pg_class c
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm')
        AND has_table_privilege('app_retention_owner', c.oid, p.privilege)
      ORDER BY 1`);
    expect(tables.map((row) => row.grant)).toEqual([
      'audit_logs DELETE',
      'platform_audit_logs DELETE',
      'support_access_grants DELETE',
      'support_sessions DELETE',
    ]);

    const { rows: columns } = await db.owner.query<{ grant: string }>(`
      SELECT c.relname || '.' || a.attname AS grant
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        AND has_column_privilege('app_retention_owner', c.oid, a.attnum, 'SELECT')
      ORDER BY 1`);
    expect(columns.map((row) => row.grant)).toEqual([
      'audit_logs.created_at',
      'audit_logs.id',
      'audit_logs.support_grant_id',
      'audit_logs.tenant_id',
      'platform_audit_logs.created_at',
      'platform_audit_logs.id',
      'support_access_grants.expires_at',
      'support_access_grants.id',
      'support_access_grants.tenant_id',
      'support_sessions.grant_id',
      'support_sessions.id',
      'support_sessions.opened_at',
      'support_sessions.tenant_id',
    ]);
    const { rows: updates } = await db.owner.query<{ grant: string }>(`
      SELECT c.relname || '.' || a.attname AS grant
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
        AND (has_column_privilege('app_retention_owner', c.oid, a.attnum, 'UPDATE') OR has_column_privilege('app_retention_owner', c.oid, a.attnum, 'INSERT'))`);
    expect(updates).toEqual([]);
  });

  it('runs every retention function only from the worker', async () => {
    const { rows } = await db.owner.query<{ fn: string; worker: boolean; runtime: boolean; platform: boolean }>(`
      SELECT p.oid::regprocedure::text AS fn,
             has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
             has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime,
             has_function_privilege('app_platform', p.oid, 'EXECUTE') AS platform
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.proname LIKE 'retention\\_%'
      ORDER BY 1`);
    expect(rows).toHaveLength(11);
    expect(rows.filter((row) => !row.worker || row.runtime || row.platform)).toEqual([]);
  });

  it('gives no application login the right to rewrite or empty a history table', async () => {
    const { rows } = await db.owner.query<{ grant: string }>(`
      SELECT r.rolname || ' ' || p.privilege || ' on ' || c.relname AS grant
      FROM pg_class c
      CROSS JOIN (VALUES ('app_runtime'), ('app_worker'), ('app_platform')) AS r(rolname)
      CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname IN ('audit_logs', 'ticket_events', 'ticket_errors', 'ticket_signatures', 'platform_audit_logs')
        AND has_table_privilege(r.rolname, c.oid, p.privilege)
        -- app_platform keeps its rights on the ticket history: tenant purges and sign-up run as that login.
        AND NOT (r.rolname = 'app_platform' AND c.relname IN ('ticket_events', 'ticket_errors', 'ticket_signatures') AND p.privilege <> 'TRUNCATE')
      ORDER BY 1`);

    expect(rows.map((row) => row.grant)).toEqual([]);
  });

  it('does not let the application roles create temporary tables', async () => {
    for (const pool of [db.runtime, db.platform, db.worker]) {
      expect(await sqlStateOf(() => pool.query('CREATE TEMP TABLE shadow (id int)'))).toBe(SqlState.insufficientPrivilege);
    }
  });

  it('gives the application roles no privilege on the platform-only tables', async () => {
    const platformOnly = ['platform_admins', 'user_tokens', 'consumed_auth_tokens', 'user_mfa_backup_codes', 'platform_outbox_events', 'platform_event_types'];
    const { rows } = await db.owner.query<{ grant: string }>(
      `
      SELECT r.rolname || ' on ' || c.relname AS grant
      FROM pg_class c
      CROSS JOIN (VALUES ('app_runtime'), ('app_worker')) AS r(rolname)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
        AND has_table_privilege(r.rolname, c.oid, p.privilege)
      `,
      [platformOnly],
    );

    expect(rows.map((row) => row.grant)).toEqual([]);
  });

  it('gives app_platform (a BYPASSRLS login) no privilege on the platform outbox, so it cannot read the reset tokens', async () => {
    const { rows } = await db.owner.query<{ grant: string }>(`
      SELECT p.privilege || ' on ' || c.relname AS grant
      FROM pg_class c
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('platform_outbox_events', 'platform_event_types')
        AND has_table_privilege('app_platform', c.oid, p.privilege)
    `);

    expect(rows.map((row) => row.grant)).toEqual([]);
  });

  it('keeps the application roles without BYPASSRLS', async () => {
    const { rows } = await db.owner.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('app_runtime', 'app_worker', 'app_outbox_owner', 'app_retention_owner') AND rolbypassrls`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps the owner roles unable to log in, and no login a member of app_retention_owner', async () => {
    const { rows } = await db.owner.query<{ rolname: string; rolcanlogin: boolean; members: number }>(`
      SELECT r.rolname, r.rolcanlogin, (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
      FROM pg_roles r WHERE r.rolname IN ('app_outbox_owner', 'app_retention_owner') ORDER BY 1`);
    expect(rows).toEqual([
      { rolname: 'app_outbox_owner', rolcanlogin: false, members: expect.any(Number) },
      { rolname: 'app_retention_owner', rolcanlogin: false, members: 0 },
    ]);
  });
});
