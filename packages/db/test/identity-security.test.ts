import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, seedTicket, type SeededTenant, type SeededTicket } from './support/fixtures.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe('identity security (API role)', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let colleagueId: string;
  let ticket: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    colleagueId = await seedMember(db.platform, tenant);
    ticket = await seedTicket(db.platform, tenant);
    await db.platform.query(`UPDATE users SET password_hash = 'secret-hash' WHERE id = $1`, [colleagueId]);
  });

  afterAll(async () => {
    await db.close();
  });

  const asMember = <T>(work: Parameters<typeof withContext<T>>[2]) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, work);

  describe('credentials', () => {
    it('cannot read password hashes or MFA secrets', async () => {
      const readHash = () => asMember((client) => client.query('SELECT password_hash FROM users WHERE id = $1', [colleagueId]));
      const readSecret = () => asMember((client) => client.query('SELECT mfa_secret_encrypted FROM users'));

      expect(await sqlStateOf(readHash)).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(readSecret)).toBe(SqlState.insufficientPrivilege);
    });

    it('can still read the public profile of members', async () => {
      const emails = await asMember(async (client) => {
        const { rows } = await client.query<{ email: string }>('SELECT id, email, first_name FROM users WHERE id = $1', [
          colleagueId,
        ]);
        return rows.map((row) => row.email);
      });

      expect(emails).toHaveLength(1);
    });
  });

  describe('identity creation', () => {
    it('cannot insert identities directly, so no one can pre-set a password for another person', async () => {
      const hijack = () => asMember((client) =>
        client.query(`INSERT INTO users (email, first_name, last_name, password_hash) VALUES ('ceo@other.com', 'x', 'y', 'known')`),
      );

      expect(await sqlStateOf(hijack)).toBe(SqlState.insufficientPrivilege);
    });

    it('creates invited identities without a password through invite_user', async () => {
      const email = `invitee-${randomUUID().slice(0, 6)}@Example.com`;
      const userId = await asMember(async (client) => {
        const { rows } = await client.query<{ id: string }>('SELECT invite_user($1, $2, $3) AS id', [email, 'Ana', 'Ruiz']);
        return rows[0]?.id;
      });

      const { rows } = await db.owner.query<{ email: string; password_hash: string | null }>(
        'SELECT email, password_hash FROM users WHERE id = $1',
        [userId],
      );
      expect(rows[0]).toEqual({ email: email.toLowerCase(), password_hash: null });
    });

    it('returns the existing identity when the e-mail already exists, without touching its password', async () => {
      const { rows: users } = await db.owner.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [colleagueId]);

      const returnedId = await asMember(async (client) => {
        const { rows } = await client.query<{ id: string }>("SELECT invite_user($1, 'X', 'Y') AS id", [users[0]?.email]);
        return rows[0]?.id;
      });

      expect(returnedId).toBe(colleagueId);
      const { rows } = await db.owner.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [colleagueId]);
      expect(rows[0]?.password_hash).toBe('secret-hash');
    });

    it('refuses invite_user without a tenant context', async () => {
      const noTenant = () => withContext(db.runtime, {}, (client) => client.query("SELECT invite_user('a@b.com', 'A', 'B')"));

      expect(await sqlStateOf(noTenant)).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('self-service profile', () => {
    it('lets a user edit their name but not their status, lockout or e-mail', async () => {
      const editName = asMember((client) => client.query(`UPDATE users SET first_name = 'Nuevo' WHERE id = $1`, [tenant.userId]));
      const unlock = () => asMember((client) =>
        client.query(`UPDATE users SET status = 'ACTIVE', locked_until = NULL WHERE id = $1`, [tenant.userId]),
      );
      const changeEmail = () => asMember((client) =>
        client.query(`UPDATE users SET email = 'other@x.com' WHERE id = $1`, [tenant.userId]),
      );

      await expect(editName).resolves.toBeDefined();
      expect(await sqlStateOf(unlock)).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(changeEmail)).toBe(SqlState.insufficientPrivilege);
    });

    it('cannot edit another member profile', async () => {
      const updated = await asMember(async (client) => {
        const result = await client.query(`UPDATE users SET first_name = 'Hacked' WHERE id = $1`, [colleagueId]);
        return result.rowCount;
      });

      expect(updated).toBe(0);
    });
  });

  describe('one-time tokens', () => {
    it('are not readable by the API role', async () => {
      expect(await sqlStateOf(() => asMember((client) => client.query('SELECT * FROM user_tokens')))).toBe(
        SqlState.insufficientPrivilege,
      );
    });

    it('reset the password once, clear the lockout and revoke sessions', async () => {
      const token = randomUUID();
      await db.platform.query(`UPDATE users SET failed_logins = 5, locked_until = now() + interval '1 hour' WHERE id = $1`, [
        colleagueId,
      ]);
      await db.platform.query(
        `INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
        [colleagueId, hashToken(randomUUID())],
      );
      await withContext(db.runtime, {}, (client) =>
        client.query(`SELECT auth_issue_user_token($1, 'PASSWORD_RESET', $2, $3)`, [colleagueId, hashToken(token), inOneHour()]),
      );

      const consume = () =>
        withContext(db.runtime, {}, (client) =>
          client.query('SELECT * FROM auth_consume_user_token($1, $2)', [hashToken(token), 'new-hash']),
        );
      await consume();

      const { rows } = await db.owner.query<{ password_hash: string; failed_logins: number; locked_until: Date | null }>(
        'SELECT password_hash, failed_logins, locked_until FROM users WHERE id = $1',
        [colleagueId],
      );
      expect(rows[0]).toEqual({ password_hash: 'new-hash', failed_logins: 0, locked_until: null });
      const sessions = await db.owner.query('SELECT 1 FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL', [
        colleagueId,
      ]);
      expect(sessions.rowCount).toBe(0);
      expect(await sqlStateOf(() => consume())).toBe(SqlState.insufficientPrivilege);
    });

    it('reject expired tokens', async () => {
      const token = randomUUID();
      await db.platform.query(
        `INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'PASSWORD_RESET', $2, now() - interval '1 minute')`,
        [colleagueId, hashToken(token)],
      );

      const consumeExpired = () => withContext(db.runtime, {}, (client) =>
        client.query('SELECT * FROM auth_consume_user_token($1, $2)', [hashToken(token), 'x']),
      );

      expect(await sqlStateOf(consumeExpired)).toBe(SqlState.insufficientPrivilege);
    });

    it('activate the invited membership when the invitation is accepted', async () => {
      const invitedId = await asMember(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT invite_user($1, 'Luis', 'Paz') AS id`,
          [`luis-${randomUUID().slice(0, 6)}@example.com`],
        );
        const id = rows[0]?.id;
        await client.query(`INSERT INTO memberships (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [
          tenant.tenantId,
          id,
          tenant.roleId,
        ]);
        await client.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [
          tenant.tenantId,
          id,
          tenant.companyId,
        ]);
        return id;
      });
      const token = randomUUID();
      await asMember((client) =>
        client.query(`SELECT auth_issue_user_token($1, 'INVITATION', $2, $3)`, [invitedId, hashToken(token), inOneHour()]),
      );

      await withContext(db.runtime, {}, (client) =>
        client.query('SELECT * FROM auth_consume_user_token($1, $2)', [hashToken(token), 'chosen-hash']),
      );

      const { rows } = await db.owner.query<{ status: string }>(
        'SELECT status FROM memberships WHERE tenant_id = $1 AND user_id = $2',
        [tenant.tenantId, invitedId],
      );
      expect(rows[0]?.status).toBe('ACTIVE');
    });

    it('only let users request an e-mail change for themselves', async () => {
      const forSomeoneElse = () => asMember((client) =>
        client.query(`SELECT auth_issue_user_token($1, 'EMAIL_CHANGE', $2, $3, '{"email":"x@y.com"}')`, [
          colleagueId,
          hashToken(randomUUID()),
          inOneHour(),
        ]),
      );

      expect(await sqlStateOf(forSomeoneElse)).toBe(SqlState.insufficientPrivilege);
    });

    it('change the e-mail when the change token is confirmed', async () => {
      const token = randomUUID();
      const newEmail = `renamed-${randomUUID().slice(0, 6)}@example.com`;
      await asMember((client) =>
        client.query(`SELECT auth_issue_user_token($1, 'EMAIL_CHANGE', $2, $3, $4)`, [
          tenant.userId,
          hashToken(token),
          inOneHour(),
          JSON.stringify({ email: newEmail }),
        ]),
      );

      await withContext(db.runtime, {}, (client) => client.query('SELECT * FROM auth_consume_user_token($1)', [hashToken(token)]));

      const { rows } = await db.owner.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [tenant.userId]);
      expect(rows[0]?.email).toBe(newEmail);
    });

    it('never let an invitation change the password of a user who already has one', async () => {
      const other = await seedTenant(db.platform);
      const asOtherAdmin = <T>(work: Parameters<typeof withContext<T>>[2]) =>
        withContext(db.runtime, { tenantId: other.tenantId, userId: other.userId }, work);
      const { rows: emails } = await db.owner.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [colleagueId]);
      const token = randomUUID();
      await asOtherAdmin(async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT invite_user($1, 'Ana', 'Ruiz') AS id`, [emails[0]!.email]);
        expect(rows[0]?.id).toBe(colleagueId);
        await client.query(`INSERT INTO memberships (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [other.tenantId, colleagueId, other.roleId]);
        await client.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [
          other.tenantId,
          colleagueId,
          other.companyId,
        ]);
        await client.query(`SELECT auth_issue_user_token($1, 'INVITATION', $2, $3)`, [colleagueId, hashToken(token), inOneHour()]);
      });
      const { rows: before } = await db.owner.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [colleagueId]);
      const consume = (newHash: string | null) =>
        withContext(db.runtime, {}, (client) =>
          client.query('SELECT * FROM auth_consume_user_token($1, $2)', [hashToken(token), newHash]),
        );
      const membershipStatus = async () =>
        (
          await db.owner.query<{ status: string }>('SELECT status FROM memberships WHERE tenant_id = $1 AND user_id = $2', [
            other.tenantId,
            colleagueId,
          ])
        ).rows[0]?.status;

      expect(await sqlStateOf(() => consume('attacker-chosen-hash'))).toBe(SqlState.checkViolation);
      expect(await membershipStatus()).toBe('INVITED');

      await consume(null);
      const { rows: after } = await db.owner.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [colleagueId]);
      expect(after[0]?.password_hash).toBe(before[0]?.password_hash);
      expect(await membershipStatus()).toBe('ACTIVE');
    });
  });

  describe('login lockout', () => {
    it('locks the account after the maximum failed attempts and clears it on success', async () => {
      const attempt = (success: boolean) =>
        withContext(db.runtime, {}, (client) =>
          client.query('SELECT auth_register_login_attempt($1, $2, 3, 15)', [colleagueId, success]),
        );
      const lockState = async () => {
        const { rows } = await db.owner.query<{ failed_logins: number; locked: boolean }>(
          'SELECT failed_logins, locked_until > now() AS locked FROM users WHERE id = $1',
          [colleagueId],
        );
        return rows[0];
      };

      await attempt(false);
      await attempt(false);
      expect(await lockState()).toEqual({ failed_logins: 2, locked: null });
      await attempt(false);
      expect(await lockState()).toEqual({ failed_logins: 3, locked: true });
      await attempt(true);
      expect(await lockState()).toEqual({ failed_logins: 0, locked: null });
    });
  });

  describe('append-only history', () => {
    it('cannot edit or delete the ticket timeline or the audit log', async () => {
      await asMember(async (client) => {
        await client.query(`INSERT INTO ticket_events (tenant_id, ticket_id, type) VALUES ($1, $2, 'CREATED')`, [
          tenant.tenantId,
          ticket.ticketId,
        ]);
        await client.query(`INSERT INTO audit_logs (tenant_id, action, entity_type) VALUES ($1, 'role.update', 'Role')`, [
          tenant.tenantId,
        ]);
      });

      const editEvent = () => asMember((client) => client.query(`UPDATE ticket_events SET type = 'CLOSED'`));
      const deleteAudit = () => asMember((client) => client.query('DELETE FROM audit_logs'));

      expect(await sqlStateOf(editEvent)).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(deleteAudit)).toBe(SqlState.insufficientPrivilege);
    });
  });
});
