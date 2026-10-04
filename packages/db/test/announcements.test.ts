import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, withPlatformTransaction, type SeededTenant } from './support/fixtures.js';

interface LoginBlockRow {
  out_id: string;
  out_title: string;
  out_starts_at: Date;
  out_ends_at: Date | null;
  out_all_tenants: boolean;
  out_tenant_ids: string[];
}

interface AnnouncementInput {
  readonly audience?: 'ALL' | 'TENANTS';
  readonly blocksLogin?: boolean;
  /** Offsets from now, as SQL intervals. */
  readonly startsIn?: string;
  readonly endsIn?: string | null;
}

const INSERT_ANNOUNCEMENT = `
  INSERT INTO platform_announcements (type, title, body, starts_at, ends_at, blocks_login, audience)
  VALUES ('MAINTENANCE', 'Window', 'Down for a while', now() + $1::interval, now() + $2::interval, $3, $4::announcement_audience)
  RETURNING id`;

describe('announcement audience and login blocks', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  const announcementParams = (input: AnnouncementInput) => [
    input.startsIn ?? '-1 hour',
    input.endsIn === undefined ? '1 hour' : input.endsIn,
    input.blocksLogin ?? true,
    input.audience ?? 'ALL',
  ];

  /** An announcement and its targets, in one platform transaction (the audience rule is checked at COMMIT). */
  const createAnnouncement = (input: AnnouncementInput, tenantIds: readonly string[] = []) =>
    withPlatformTransaction(db.platform, async (tx) => {
      const id = await insertReturningId(tx, INSERT_ANNOUNCEMENT, announcementParams(input));
      for (const tenantId of tenantIds) {
        await tx.query('INSERT INTO platform_announcement_tenants (tenant_id, announcement_id) VALUES ($1, $2)', [tenantId, id]);
      }
      return id;
    });

  const targetsOf = async (announcementId: string) =>
    (await db.owner.query<{ tenant_id: string }>('SELECT tenant_id FROM platform_announcement_tenants WHERE announcement_id = $1 ORDER BY tenant_id', [announcementId])).rows.map(
      (row) => row.tenant_id,
    );

  const loginBlocks = async () => withoutContext(db.runtime, async (client) => (await client.query<LoginBlockRow>('SELECT * FROM auth_login_blocks()')).rows);

  describe('audience rule', () => {
    it('refuses a TENANTS announcement without tenants at COMMIT, and accepts it with targets added in the same transaction', async () => {
      expect(await sqlStateOf(() => createAnnouncement({ audience: 'TENANTS' }))).toBe(SqlState.checkViolation);

      const id = await createAnnouncement({ audience: 'TENANTS' }, [tenantA.tenantId]);
      expect(await targetsOf(id)).toEqual([tenantA.tenantId]);
    });

    it('lets an ALL announcement have no tenants', async () => {
      const id = await createAnnouncement({ audience: 'ALL' });
      expect(await targetsOf(id)).toEqual([]);
    });

    it('refuses removing the last tenant, but not one of two, and allows replacing them in one transaction', async () => {
      const id = await createAnnouncement({ audience: 'TENANTS' }, [tenantA.tenantId, tenantB.tenantId]);
      await db.platform.query('DELETE FROM platform_announcement_tenants WHERE announcement_id = $1 AND tenant_id = $2', [id, tenantB.tenantId]);

      expect(await sqlStateOf(() => db.platform.query('DELETE FROM platform_announcement_tenants WHERE announcement_id = $1', [id]))).toBe(SqlState.checkViolation);
      const other = await createAnnouncement({ audience: 'ALL', blocksLogin: false });
      expect(await sqlStateOf(() => db.platform.query('UPDATE platform_announcement_tenants SET announcement_id = $2 WHERE announcement_id = $1', [id, other]))).toBe(SqlState.checkViolation);

      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query('DELETE FROM platform_announcement_tenants WHERE announcement_id = $1', [id]);
        await tx.query('INSERT INTO platform_announcement_tenants (tenant_id, announcement_id) VALUES ($1, $2)', [tenantB.tenantId, id]);
      });
      expect(await targetsOf(id)).toEqual([tenantB.tenantId]);
    });

    it('refuses switching an announcement to TENANTS without adding tenants', async () => {
      const id = await createAnnouncement({ audience: 'ALL' });
      expect(await sqlStateOf(() => db.platform.query(`UPDATE platform_announcements SET audience = 'TENANTS' WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
    });

    it('deletes the targets with the announcement', async () => {
      const id = await createAnnouncement({ audience: 'TENANTS' }, [tenantA.tenantId]);
      await db.platform.query('DELETE FROM platform_announcements WHERE id = $1', [id]);
      expect(await targetsOf(id)).toEqual([]);
    });

    it('lets the purge of a tenant remove its targets, even the last one of an announcement', async () => {
      const doomed = await seedTenant(db.platform);
      const onlyDoomed = await createAnnouncement({ audience: 'TENANTS' }, [doomed.tenantId]);
      const shared = await createAnnouncement({ audience: 'TENANTS' }, [doomed.tenantId, tenantA.tenantId]);

      await withoutContext(db.platform, (client) => client.query('SELECT purge_tenant($1)', [doomed.tenantId]));

      expect(await targetsOf(onlyDoomed)).toEqual([]);
      expect(await targetsOf(shared)).toEqual([tenantA.tenantId]);
      const { rowCount } = await db.owner.query('SELECT 1 FROM platform_announcements WHERE id = $1', [onlyDoomed]);
      expect(rowCount).toBe(1);
    });

    it('refuses an end that is not after the start', async () => {
      expect(await sqlStateOf(() => createAnnouncement({ startsIn: '1 hour', endsIn: '1 hour' }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => createAnnouncement({ startsIn: '1 hour', endsIn: '30 minutes' }))).toBe(SqlState.checkViolation);
    });

    it('refuses an unknown tenant', async () => {
      expect(await sqlStateOf(() => createAnnouncement({ audience: 'TENANTS' }, ['018f3c1e-7b2a-7c3d-9e4f-0123456789ab']))).toBe(SqlState.foreignKeyViolation);
    });
  });

  describe('target rows under row-level security', () => {
    it('shows members only their own tenant rows', async () => {
      const id = await createAnnouncement({ audience: 'TENANTS' }, [tenantA.tenantId, tenantB.tenantId]);

      for (const tenant of [tenantA, tenantB]) {
        const rows = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, async (client) =>
          (await client.query<{ tenant_id: string }>('SELECT tenant_id FROM platform_announcement_tenants WHERE announcement_id = $1', [id])).rows,
        );
        expect(rows.map((row) => row.tenant_id)).toEqual([tenant.tenantId]);
      }
      const anonymous = await withContext(db.runtime, {}, async (client) => (await client.query('SELECT 1 FROM platform_announcement_tenants')).rowCount);
      expect(anonymous).toBe(0);
    });

    it('lets neither the API nor the worker write them, not even for their own tenant', async () => {
      const id = await createAnnouncement({ audience: 'ALL' });
      for (const pool of [db.runtime, db.worker]) {
        const context = { tenantId: tenantA.tenantId, userId: tenantA.userId };
        expect(
          await sqlStateOf(() => withContext(pool, context, (client) => client.query('INSERT INTO platform_announcement_tenants (tenant_id, announcement_id) VALUES ($1, $2)', [tenantA.tenantId, id]))),
        ).toBe(SqlState.insufficientPrivilege);
        expect(await sqlStateOf(() => withContext(pool, context, (client) => client.query('DELETE FROM platform_announcement_tenants')))).toBe(SqlState.insufficientPrivilege);
        expect(await sqlStateOf(() => withContext(pool, context, (client) => client.query('UPDATE platform_announcement_tenants SET tenant_id = tenant_id')))).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('keeps the announcements themselves read-only for the API', async () => {
      expect(await sqlStateOf(() => withContext(db.runtime, {}, (client) => client.query(INSERT_ANNOUNCEMENT, announcementParams({}))))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('auth_login_blocks()', () => {
    it('returns the blocking announcements in force or starting within 24 hours, with their audience', async () => {
      const active = await createAnnouncement({ startsIn: '-1 hour', endsIn: '1 hour' });
      const openEnded = await createAnnouncement({ startsIn: '-1 hour', endsIn: null });
      const upcoming = await createAnnouncement({ startsIn: '23 hours', endsIn: '25 hours' });
      const targeted = await createAnnouncement({ audience: 'TENANTS' }, [tenantB.tenantId, tenantA.tenantId]);
      const tooFar = await createAnnouncement({ startsIn: '25 hours', endsIn: '26 hours' });
      const over = await createAnnouncement({ startsIn: '-2 hours', endsIn: '-1 hour' });
      const notBlocking = await createAnnouncement({ blocksLogin: false });

      const rows = await loginBlocks();
      const byId = new Map(rows.map((row) => [row.out_id, row]));

      expect([active, openEnded, upcoming, targeted].every((id) => byId.has(id))).toBe(true);
      expect([tooFar, over, notBlocking].some((id) => byId.has(id))).toBe(false);
      expect(byId.get(active)).toMatchObject({ out_title: 'Window', out_all_tenants: true, out_tenant_ids: [] });
      expect(byId.get(openEnded)?.out_ends_at).toBeNull();
      expect(byId.get(targeted)).toMatchObject({ out_all_tenants: false, out_tenant_ids: [tenantA.tenantId, tenantB.tenantId].sort() });
    });

    it('returns the earliest first, 200 at most', async () => {
      const rows = await loginBlocks();
      const starts = rows.map((row) => row.out_starts_at.getTime());
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(rows.length).toBeLessThanOrEqual(200);
    });

    it('runs as a SECURITY DEFINER of app_platform that the API may execute and PUBLIC may not', async () => {
      const { rows } = await db.owner.query<{ owner: string; definer: boolean; runtime: boolean; public_acl: boolean }>(`
        SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer,
               has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime,
               EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_acl
        FROM pg_proc p WHERE p.oid = 'auth_login_blocks()'::regprocedure`);
      expect(rows[0]).toEqual({ owner: 'app_platform', definer: true, runtime: true, public_acl: false });
    });
  });
});
