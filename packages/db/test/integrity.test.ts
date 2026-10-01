import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import {
  seedDraftWorkflow,
  seedTenant,
  seedTicket,
  withPlatformTransaction,
  type SeededTenant,
  type SeededTicket,
} from './support/fixtures.js';

const FOUR_MEGABYTES = 4 * 1024 * 1024;
const HEX_SHA256 = 'a'.repeat(64);

describe('data integrity', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let ticketA: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenantA = await seedTenant(db.platform);
    tenantB = await seedTenant(db.platform);
    ticketA = await seedTicket(db.platform, tenantA);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('composite foreign keys', () => {
    it('reject a ticket pointing to another tenant company, even when RLS is bypassed', async () => {
      const crossTenant = () => db.platform.query(
        `INSERT INTO tickets (tenant_id, number, workflow_id, workflow_version_id, subcategory_id, company_id, creator_id,
                              title, description_html)
         VALUES ($1, 999, $2, $3, $4, $5, $6, 't', 'd')`,
        [tenantA.tenantId, ticketA.workflowId, ticketA.versionId, ticketA.subcategoryId, tenantB.companyId, tenantA.userId],
      );

      expect(await sqlStateOf(crossTenant)).toBe(SqlState.foreignKeyViolation);
    });

    it('reject assigning a ticket to a user who is not a member of the tenant', async () => {
      const assignOutsider = () => db.platform.query(
        `INSERT INTO ticket_assignees (tenant_id, ticket_id, user_id, type) VALUES ($1, $2, $3, 'PRIMARY')`,
        [tenantA.tenantId, ticketA.ticketId, tenantB.userId],
      );

      expect(await sqlStateOf(assignOutsider)).toBe(SqlState.foreignKeyViolation);
    });

    it('reject a transition between steps of different workflow versions', async () => {
      const draftA = await seedDraftWorkflow(db.platform, tenantA);
      const draftB = await seedDraftWorkflow(db.platform, tenantA);

      const crossVersion = () => db.platform.query(
        `INSERT INTO transitions (tenant_id, version_id, from_step_id, to_step_id, type, label)
         VALUES ($1, $2, $3, $4, 'DECISION', 'Next')`,
        [tenantA.tenantId, draftA.versionId, draftA.taskStepId, draftB.taskStepId],
      );

      expect(await sqlStateOf(crossVersion)).toBe(SqlState.foreignKeyViolation);
    });
  });

  describe('single-record rules', () => {
    it('allow only one default company per tenant', async () => {
      const secondDefault = () => db.platform.query(
        `INSERT INTO companies (tenant_id, name, is_default, country_code, currency_code, time_zone)
         VALUES ($1, 'Second default', true, 'CO', 'COP', 'America/Bogota')`,
        [tenantA.tenantId],
      );

      expect(await sqlStateOf(secondDefault)).toBe(SqlState.uniqueViolation);
    });

    it('allow only one open incident per ticket', async () => {
      const ticket = await seedTicket(db.platform, tenantA);
      const openIncident = (tx: pg.PoolClient) =>
        tx.query(
          `INSERT INTO ticket_incidents (tenant_id, ticket_id, step_id, created_by_id, assigned_to_id, description)
           VALUES ($1, $2, $3, $4, $4, 'Missing document')`,
          [tenantA.tenantId, ticket.ticketId, ticket.taskStepId, tenantA.userId],
        );

      const secondIncident = () => withPlatformTransaction(db.platform, async (tx) => {
        await tx.query(`UPDATE tickets SET status = 'PAUSED' WHERE tenant_id = $1 AND id = $2`, [tenantA.tenantId, ticket.ticketId]);
        await openIncident(tx);
        await openIncident(tx);
      });

      expect(await sqlStateOf(secondIncident)).toBe(SqlState.uniqueViolation);
    });
  });

  describe('check constraints', () => {
    it('reject a closed ticket without a closing date', async () => {
      const closeWithoutDate = () => db.platform.query(`UPDATE tickets SET status = 'CLOSED' WHERE tenant_id = $1 AND id = $2`, [
        tenantA.tenantId,
        ticketA.ticketId,
      ]);

      expect(await sqlStateOf(closeWithoutDate)).toBe(SqlState.checkViolation);
    });

    it('reject user uploads larger than 4 MB but accept system files of any size', async () => {
      const insertFile = (origin: 'USER' | 'SYSTEM', sizeBytes: number) =>
        db.platform.query(
          `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin)
           VALUES ($1::uuid, $5::uuid, 'tenants/' || $1::text || '/2026/10/' || $5, 'file.pdf', 'application/pdf', $2, $3, $4)`,
          [tenantA.tenantId, sizeBytes, HEX_SHA256, origin, randomUUID()],
        );

      await expect(insertFile('USER', FOUR_MEGABYTES)).resolves.toBeDefined();
      expect(await sqlStateOf(() => insertFile('USER', FOUR_MEGABYTES + 1))).toBe(SqlState.checkViolation);
      await expect(insertFile('SYSTEM', FOUR_MEGABYTES * 3)).resolves.toBeDefined();
    });

    it('reject a file hash that is not a hexadecimal SHA-256', async () => {
      const badHash = () => db.platform.query(
        `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin)
         VALUES ($1::uuid, $3::uuid, 'tenants/' || $1::text || '/2026/10/' || $3, 'a.pdf', 'application/pdf', 1, $2, 'USER')`,
        [tenantA.tenantId, 'z'.repeat(64), randomUUID()],
      );

      expect(await sqlStateOf(badHash)).toBe(SqlState.checkViolation);
    });

    it('reject a step with an SLA value but no unit', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenantA);
      const halfSla = () => db.platform.query(
        `INSERT INTO steps (tenant_id, version_id, type, name, assignment_mode, sla_value)
         VALUES ($1, $2, 'TASK', 'Review', 'CREATOR', 8)`,
        [tenantA.tenantId, draft.versionId],
      );

      expect(await sqlStateOf(halfSla)).toBe(SqlState.checkViolation);
    });

    it('reject e-mails that are not lowercase', async () => {
      const upperCaseEmail = () => db.platform.query(
        `INSERT INTO users (email, first_name, last_name) VALUES ('Someone@Example.com', 'A', 'B')`,
      );

      expect(await sqlStateOf(upperCaseEmail)).toBe(SqlState.checkViolation);
    });

    it('reject unknown time zones on tenants, companies and users', async () => {
      const badCompany = () => db.platform.query(`UPDATE companies SET time_zone = 'Mars/Olympus' WHERE tenant_id = $1`, [
        tenantA.tenantId,
      ]);
      const badUser = () => db.platform.query(`UPDATE users SET time_zone = 'Mars/Olympus' WHERE id = $1`, [tenantA.userId]);

      expect(await sqlStateOf(badCompany)).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(badUser)).toBe(SqlState.checkViolation);
    });

    it('reject amount rules without a currency known to the platform', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenantA);
      const unknownCurrency = () => db.platform.query(
        `INSERT INTO amount_rules (tenant_id, version_id, field_code, max_amount, currency_code, action)
         VALUES ($1, $2, 'AMOUNT', 1000, 'XXX', 'BLOCK')`,
        [tenantA.tenantId, draft.versionId],
      );

      expect(await sqlStateOf(unknownCurrency)).toBe(SqlState.foreignKeyViolation);
    });

    it('reject malformed field codes (they are referenced by PDFs and exports)', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenantA);
      const badCode = () => db.platform.query(
        `INSERT INTO fields (tenant_id, version_id, step_id, code, label, type) VALUES ($1, $2, $3, 'amount paid', 'x', 'TEXT')`,
        [tenantA.tenantId, draft.versionId, draft.taskStepId],
      );

      expect(await sqlStateOf(badCode)).toBe(SqlState.checkViolation);
    });
  });

  describe('tenant purge', () => {
    it('removes every row of the tenant and the identities that belonged only to it', async () => {
      const doomed = await seedTenant(db.platform);
      await seedTicket(db.platform, doomed);

      await db.platform.query('SELECT purge_tenant($1)', [doomed.tenantId]);

      const { rows } = await db.owner.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
      );
      for (const { table_name: table } of rows) {
        const remaining = await db.owner.query<{ count: string }>(`SELECT count(*) FROM "${table}" WHERE tenant_id = $1`, [
          doomed.tenantId,
        ]);
        expect({ table, count: Number(remaining.rows[0]?.count) }).toEqual({ table, count: 0 });
      }
      const users = await db.owner.query('SELECT 1 FROM users WHERE id = $1', [doomed.userId]);
      expect(users.rowCount).toBe(0);
    });

    it('keeps identities that still belong to another tenant', async () => {
      const doomed = await seedTenant(db.platform);
      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
          tenantA.tenantId,
          doomed.userId,
          tenantA.roleId,
        ]);
        await tx.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [
          tenantA.tenantId,
          doomed.userId,
          tenantA.companyId,
        ]);
      });

      await db.platform.query('SELECT purge_tenant($1)', [doomed.tenantId]);

      const users = await db.owner.query('SELECT 1 FROM users WHERE id = $1', [doomed.userId]);
      expect(users.rowCount).toBe(1);
    });

    it('refuses to delete a tenant with published workflows outside purge_tenant', async () => {
      const tenant = await seedTenant(db.platform);
      await seedTicket(db.platform, tenant);

      const plainDelete = () => db.platform.query('DELETE FROM tenants WHERE id = $1', [tenant.tenantId]);

      expect(await sqlStateOf(plainDelete)).toBe(SqlState.restrictViolation);
    });

    it('is not available to the API role', async () => {
      const tenant = await seedTenant(db.platform);

      expect(await sqlStateOf(() => db.runtime.query('SELECT purge_tenant($1)', [tenant.tenantId]))).toBe(
        SqlState.insufficientPrivilege,
      );
    });
  });
});
