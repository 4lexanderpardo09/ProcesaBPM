import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, seedTicket, type SeededTenant } from './support/fixtures.js';

const hash = () => randomUUID().replace(/-/g, '').padEnd(43, 'x');

describe('outbox dispatch: typed claims, worker-issued tokens and notifications', () => {
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

  describe('claim_outbox_events with a type filter', () => {
    const insertEvent = async (type: string, owner = tenant) =>
      (await db.platform.query<{ id: string }>(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, $2, '{}') RETURNING id`, [owner.tenantId, type])).rows[0]!.id;
    const claim = (types: string[] | null, limit = 1000) =>
      withoutContext(db.worker, async (client) => (await client.query<{ id: string; type: string }>('SELECT id, type FROM claim_outbox_events($1, $2::text[])', [limit, types])).rows);

    it('claims only the requested types and leaves the others untouched and PENDING', async () => {
      const wanted = await insertEvent('filter.wanted');
      const unwanted = await insertEvent('filter.unwanted');
      const claimed = (await claim(['filter.wanted'])).map((event) => event.id);
      expect(claimed).toContain(wanted);
      expect(claimed).not.toContain(unwanted);
      const state = await db.owner.query<{ status: string; attempts: number }>('SELECT status, attempts FROM outbox_events WHERE id = $1', [unwanted]);
      expect(state.rows[0]).toEqual({ status: 'PENDING', attempts: 0 });
    });

    it('claims nothing for an empty list of types', async () => {
      await insertEvent('filter.empty');
      expect(await claim([])).toEqual([]);
    });

    it('two concurrent claims never return the same event', async () => {
      for (let index = 0; index < 20; index += 1) await insertEvent('filter.race');
      const [first, second] = await Promise.all([claim(['filter.race'], 12), claim(['filter.race'], 12)]);
      const ids = [...first, ...second].map((event) => event.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(20);
    });
  });

  describe('worker-issued tokens', () => {
    const issueReset = (eventId: string, userId: string, tokenHash: string, ttl = '30 minutes') =>
      withoutContext(db.worker, async (client) => (await client.query<{ out_email: string; out_expires_at: Date }>('SELECT * FROM worker_issue_password_reset_token($1, $2, $3, $4::interval)', [eventId, userId, tokenHash, ttl])).rows);
    const issueInvitation = (eventId: string, tenantId: string, userId: string, tokenHash: string, ttl = '7 days') =>
      withoutContext(db.worker, async (client) => (await client.query<{ out_email: string; out_tenant_name: string }>('SELECT * FROM worker_issue_invitation_token($1, $2, $3, $4, $5::interval)', [eventId, tenantId, userId, tokenHash, ttl])).rows);
    const tokens = async (userId: string, type: string) => (await db.owner.query<{ token_hash: string; consumed_at: Date | null; source_event_id: string }>('SELECT token_hash, consumed_at, source_event_id FROM user_tokens WHERE user_id = $1 AND type = $2 ORDER BY created_at, id', [userId, type])).rows;

    it('a reset is idempotent per event: the retry finds the same row, no second token', async () => {
      const userId = await seedMember(db.platform, tenant);
      const [event, tokenHash] = [randomUUID(), hash()];
      expect(await issueReset(event, userId, tokenHash)).toHaveLength(1);
      const again = await issueReset(event, userId, tokenHash);
      expect(again).toHaveLength(1);
      expect(await tokens(userId, 'PASSWORD_RESET')).toHaveLength(1);
    });

    it('rewrites the hash of an unused token when the derivation key changed', async () => {
      const userId = await seedMember(db.platform, tenant);
      const event = randomUUID();
      await issueReset(event, userId, hash());
      const rotated = hash();
      await issueReset(event, userId, rotated);
      expect((await tokens(userId, 'PASSWORD_RESET')).map((row) => row.token_hash)).toEqual([rotated]);
    });

    it('a newer request supersedes the earlier link, and a used or superseded one is not sent again', async () => {
      const userId = await seedMember(db.platform, tenant);
      const first = randomUUID();
      await issueReset(first, userId, hash());
      await issueReset(randomUUID(), userId, hash());
      const rows = await tokens(userId, 'PASSWORD_RESET');
      expect(rows.map((row) => row.consumed_at !== null)).toEqual([true, false]);
      expect(await issueReset(first, userId, hash())).toEqual([]);
    });

    it('sends nothing for a user that is not active, and never reuses an event for another user', async () => {
      const disabled = await seedMember(db.platform, tenant);
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled]);
      expect(await issueReset(randomUUID(), disabled, hash())).toEqual([]);
      const [a, b] = [await seedMember(db.platform, tenant), await seedMember(db.platform, tenant)];
      const event = randomUUID();
      await issueReset(event, a, hash());
      expect(await sqlStateOf(() => issueReset(event, b, hash()))).toBe(SqlState.insufficientPrivilege);
    });

    it('an invitation needs an active tenant and a pending membership, and replaces earlier links of that tenant only', async () => {
      const userId = await seedMember(db.platform, tenant);
      expect(await issueInvitation(randomUUID(), tenant.tenantId, userId, hash())).toEqual([]);
      await db.platform.query(`UPDATE memberships SET status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, userId]);
      const [first, second] = [randomUUID(), randomUUID()];
      expect(await issueInvitation(first, tenant.tenantId, userId, hash())).toHaveLength(1);
      expect(await issueInvitation(first, tenant.tenantId, userId, hash())).toHaveLength(1);
      expect(await tokens(userId, 'INVITATION')).toHaveLength(1);
      await issueInvitation(second, tenant.tenantId, userId, hash());
      expect((await tokens(userId, 'INVITATION')).map((row) => row.consumed_at !== null)).toEqual([true, false]);
      expect(await issueInvitation(randomUUID(), other.tenantId, userId, hash())).toEqual([]);
    });

    it('does not invite into a suspended tenant', async () => {
      const suspended = await seedTenant(db.platform);
      const userId = await seedMember(db.platform, suspended);
      await db.platform.query(`UPDATE memberships SET status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [suspended.tenantId, userId]);
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [suspended.tenantId]);
      expect(await issueInvitation(randomUUID(), suspended.tenantId, userId, hash())).toEqual([]);
    });

    it.each(['worker_issue_password_reset_token', 'worker_issue_invitation_token'])('only the worker may call %s', async (name) => {
      const roles = await db.owner.query<{ role: string; allowed: boolean }>(
        `SELECT r.rolname AS role, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS allowed
         FROM pg_proc p CROSS JOIN pg_roles r WHERE p.proname = $1 AND r.rolname IN ('app_runtime', 'app_platform', 'app_worker')`,
        [name],
      );
      expect(Object.fromEntries(roles.rows.map((row) => [row.role, row.allowed]))).toEqual({ app_runtime: false, app_platform: true, app_worker: true });
    });
  });

  describe('notifications', () => {
    let ticketId: string;
    let alice: string;
    let bob: string;

    const insertFor = (userId: string, sourceEventId: string | null, owner = tenant) =>
      db.platform.query(`INSERT INTO notifications (tenant_id, user_id, ticket_id, type, title, body, source_event_id) VALUES ($1, $2, $3, 'TICKET_ASSIGNED', 't', 'b', $4)`, [owner.tenantId, userId, owner === tenant ? ticketId : null, sourceEventId]);

    beforeAll(async () => {
      ticketId = (await seedTicket(db.platform, tenant)).ticketId;
      [alice, bob] = [await seedMember(db.platform, tenant), await seedMember(db.platform, tenant)];
    });

    it('allows one notification per person per event, and any number without an event', async () => {
      const event = randomUUID();
      await insertFor(alice, event);
      await insertFor(bob, event);
      expect(await sqlStateOf(() => insertFor(alice, event))).toBe(SqlState.uniqueViolation);
      await insertFor(alice, null);
      await insertFor(alice, null);
    });

    it('a request sees and changes only its own notifications; the worker, without a user, sees the tenant', async () => {
      const mine = await insertReturningId(db.platform, `INSERT INTO notifications (tenant_id, user_id, type, title, body) VALUES ($1, $2, 'TICKET_CLOSED', 'mine', 'b') RETURNING id`, [tenant.tenantId, alice]);
      const theirs = await insertReturningId(db.platform, `INSERT INTO notifications (tenant_id, user_id, type, title, body) VALUES ($1, $2, 'TICKET_CLOSED', 'theirs', 'b') RETURNING id`, [tenant.tenantId, bob]);
      const visible = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: alice }, async (client) => (await client.query<{ id: string }>('SELECT id FROM notifications')).rows.map((row) => row.id));
      expect(visible).toContain(mine);
      expect(visible).not.toContain(theirs);
      const touched = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: alice }, async (client) => (await client.query('UPDATE notifications SET read_at = now() WHERE id = $1', [theirs])).rowCount);
      expect(touched).toBe(0);
      const seenByWorker = await withContext(db.worker, { tenantId: tenant.tenantId }, async (client) => (await client.query<{ id: string }>('SELECT id FROM notifications')).rows.map((row) => row.id));
      expect(seenByWorker).toEqual(expect.arrayContaining([mine, theirs]));
    });

    it('a request may only mark notifications as read: no other column, no delete, no insert for somebody else', async () => {
      const id = await insertReturningId(db.platform, `INSERT INTO notifications (tenant_id, user_id, type, title, body) VALUES ($1, $2, 'TICKET_CLOSED', 'mine', 'b') RETURNING id`, [tenant.tenantId, alice]);
      const asAlice = <T>(work: Parameters<typeof withContext<T>>[2]) => withContext(db.runtime, { tenantId: tenant.tenantId, userId: alice }, work);
      await asAlice((client) => client.query('UPDATE notifications SET read_at = now() WHERE id = $1', [id]));
      expect(await sqlStateOf(() => asAlice((client) => client.query(`UPDATE notifications SET title = 'edited' WHERE id = $1`, [id])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asAlice((client) => client.query('DELETE FROM notifications WHERE id = $1', [id])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asAlice((client) => client.query(`INSERT INTO notifications (tenant_id, user_id, type, title, body) VALUES ($1, $2, 'TICKET_CLOSED', 'x', 'y')`, [tenant.tenantId, bob])))).toBe('42501');
    });

    it("preferences are private too: somebody else's cannot be read or written", async () => {
      await db.platform.query(`INSERT INTO notification_preferences (tenant_id, user_id, type, in_app, email) VALUES ($1, $2, 'TICKET_CLOSED', false, false)`, [tenant.tenantId, bob]);
      const asAlice = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: alice }, async (client) => (await client.query('SELECT 1 FROM notification_preferences WHERE user_id = $1', [bob])).rowCount);
      expect(asAlice).toBe(0);
    });
  });
});
