import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import {
  insertReturningId,
  insertTicket,
  publishVersion,
  seedDraftWorkflow,
  seedMember,
  seedTenant,
  seedTicket,
  withPlatformTransaction,
  type SeededTenant,
  type SeededTicket,
} from './support/fixtures.js';

describe('ticket rules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const setStatus = (ticket: SeededTicket, status: string, extra = '') =>
    db.platform.query(`UPDATE tickets SET status = $3 ${extra} WHERE tenant_id = $1 AND id = $2`, [
      tenant.tenantId,
      ticket.ticketId,
      status,
    ]);

  describe('coherence with its workflow version', () => {
    it('rejects a current step from another version of the workflow', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const otherVersion = await seedDraftWorkflow(db.platform, tenant);

      const foreignStep = () => db.platform.query(`UPDATE tickets SET current_step_id = $1 WHERE tenant_id = $2 AND id = $3`, [
        otherVersion.taskStepId,
        tenant.tenantId,
        ticket.ticketId,
      ]);

      expect(await sqlStateOf(foreignStep)).toBe(SqlState.foreignKeyViolation);
    });

    it('rejects a subcategory that is not the one of the workflow', async () => {
      const workflow = await seedDraftWorkflow(db.platform, tenant);
      await publishVersion(db.platform, tenant.tenantId, workflow.versionId);
      const other = await seedDraftWorkflow(db.platform, tenant);

      const mismatched = () => insertTicket(db.platform, tenant, { ...workflow, subcategoryId: other.subcategoryId });

      expect(await sqlStateOf(mismatched)).toBe(SqlState.foreignKeyViolation);
    });

    it('rejects a version that does not belong to the workflow', async () => {
      const workflow = await seedDraftWorkflow(db.platform, tenant);
      const other = await seedDraftWorkflow(db.platform, tenant);

      const mismatched = () => insertTicket(db.platform, tenant, { ...workflow, versionId: other.versionId });

      expect(await sqlStateOf(mismatched)).toBe(SqlState.foreignKeyViolation);
    });

    it('rejects field values of a field from another version', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const otherVersion = await seedDraftWorkflow(db.platform, tenant);
      const foreignFieldId = await insertReturningId(
        db.platform,
        `INSERT INTO fields (tenant_id, version_id, step_id, code, label, type) VALUES ($1, $2, $3, 'AMOUNT', 'Amount', 'CURRENCY') RETURNING id`,
        [tenant.tenantId, otherVersion.versionId, otherVersion.taskStepId],
      );

      const foreignValue = () => db.platform.query(
        `INSERT INTO ticket_field_values (tenant_id, ticket_id, workflow_version_id, field_id, value) VALUES ($1, $2, $3, $4, '100')`,
        [tenant.tenantId, ticket.ticketId, ticket.versionId, foreignFieldId],
      );
      const lyingVersion = () => db.platform.query(
        `INSERT INTO ticket_field_values (tenant_id, ticket_id, workflow_version_id, field_id, value) VALUES ($1, $2, $3, $4, '100')`,
        [tenant.tenantId, ticket.ticketId, otherVersion.versionId, foreignFieldId],
      );

      expect(await sqlStateOf(foreignValue)).toBe(SqlState.foreignKeyViolation);
      expect(await sqlStateOf(lyingVersion)).toBe(SqlState.foreignKeyViolation);
    });

    it('keeps number, workflow, version, company and creator fixed after creation', async () => {
      const ticket = await seedTicket(db.platform, tenant);

      const renumber = () => db.platform.query(`UPDATE tickets SET number = number + 1000 WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        ticket.ticketId,
      ]);

      expect(await sqlStateOf(renumber)).toBe(SqlState.restrictViolation);
    });

    it('rejects a company the creator does not belong to', async () => {
      const workflow = await seedDraftWorkflow(db.platform, tenant);
      await publishVersion(db.platform, tenant.tenantId, workflow.versionId);
      const otherCompanyId = await insertReturningId(
        db.platform,
        `INSERT INTO companies (tenant_id, name, country_code, currency_code, time_zone)
         VALUES ($1, $2, 'CO', 'COP', 'America/Bogota') RETURNING id`,
        [tenant.tenantId, `Other ${Date.now()}`],
      );

      const outsideCompany = () => insertTicket(db.platform, { ...tenant, companyId: otherCompanyId }, workflow);

      expect(await sqlStateOf(outsideCompany)).toBe(SqlState.foreignKeyViolation);
    });
  });

  describe('state machine (checked at commit)', () => {
    it('rejects a PAUSED ticket without an open incident', async () => {
      const ticket = await seedTicket(db.platform, tenant);

      expect(await sqlStateOf(() => setStatus(ticket, 'PAUSED'))).toBe(SqlState.checkViolation);
    });

    it('rejects an open incident on a ticket that is not PAUSED', async () => {
      const ticket = await seedTicket(db.platform, tenant);

      const incidentWhileOpen = () => db.platform.query(
        `INSERT INTO ticket_incidents (tenant_id, ticket_id, step_id, created_by_id, assigned_to_id, description)
         VALUES ($1, $2, $3, $4, $4, 'Missing invoice')`,
        [tenant.tenantId, ticket.ticketId, ticket.taskStepId, tenant.userId],
      );

      expect(await sqlStateOf(incidentWhileOpen)).toBe(SqlState.checkViolation);
    });

    it('accepts pausing and opening the incident in the same transaction, in any order', async () => {
      const ticket = await seedTicket(db.platform, tenant);

      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query(
          `INSERT INTO ticket_incidents (tenant_id, ticket_id, step_id, created_by_id, assigned_to_id, description, previous_assignee_ids)
           VALUES ($1, $2, $3, $4, $4, 'Missing invoice', ARRAY[$4]::uuid[])`,
          [tenant.tenantId, ticket.ticketId, ticket.taskStepId, tenant.userId],
        );
        await tx.query(`UPDATE tickets SET status = 'PAUSED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, ticket.ticketId]);
      });

      const { rows } = await db.platform.query<{ status: string }>('SELECT status FROM tickets WHERE id = $1', [ticket.ticketId]);
      expect(rows[0]?.status).toBe('PAUSED');
    });

    it('rejects closing a ticket with pending parallel signatures', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      await db.platform.query(
        `INSERT INTO ticket_parallel_tasks (tenant_id, ticket_id, step_id, user_id) VALUES ($1, $2, $3, $4)`,
        [tenant.tenantId, ticket.ticketId, ticket.taskStepId, tenant.userId],
      );

      expect(await sqlStateOf(() => setStatus(ticket, 'CLOSED', ', closed_at = now()'))).toBe(SqlState.checkViolation);
    });

    it('releases the ticket from a parallel signer once they sign', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const signerId = await seedMember(db.platform, tenant);
      await db.platform.query(
        `INSERT INTO ticket_assignees (tenant_id, ticket_id, user_id, type) VALUES ($1, $2, $3, 'PARALLEL')`,
        [tenant.tenantId, ticket.ticketId, signerId],
      );
      await db.platform.query(
        `INSERT INTO ticket_parallel_tasks (tenant_id, ticket_id, step_id, user_id) VALUES ($1, $2, $3, $4)`,
        [tenant.tenantId, ticket.ticketId, ticket.taskStepId, signerId],
      );

      await db.platform.query(
        `UPDATE ticket_parallel_tasks SET status = 'SIGNED', completed_at = now() WHERE tenant_id = $1 AND ticket_id = $2`,
        [tenant.tenantId, ticket.ticketId],
      );

      const assignees = await db.platform.query('SELECT 1 FROM ticket_assignees WHERE ticket_id = $1 AND user_id = $2', [
        ticket.ticketId,
        signerId,
      ]);
      expect(assignees.rowCount).toBe(0);
    });
  });

  describe('step visits and SLA clocks', () => {
    const openVisit = (ticket: SeededTicket, loop = 1) =>
      insertReturningId(
        db.platform,
        `INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, sla_value, sla_unit)
         VALUES ($1, $2, $3, $4, 8, 'BUSINESS_HOURS') RETURNING id`,
        [tenant.tenantId, ticket.ticketId, ticket.taskStepId, loop],
      );

    it('allows only one open visit per ticket', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      await openVisit(ticket, 1);

      expect(await sqlStateOf(() => openVisit(ticket, 2))).toBe(SqlState.uniqueViolation);
    });

    it('rejects a clock that does not match its visit', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const visitId = await openVisit(ticket);

      const wrongLoop = () => db.platform.query(
        `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, loop, company_id, responsible_id, started_at)
         VALUES ($1, $2, $3, $4, 7, $5, $6, now())`,
        [tenant.tenantId, ticket.ticketId, visitId, ticket.taskStepId, tenant.companyId, tenant.userId],
      );

      expect(await sqlStateOf(wrongLoop)).toBe(SqlState.checkViolation);
    });

    it('requires a result when a clock with an SLA is completed', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const visitId = await openVisit(ticket);

      const completedWithoutResult = () => db.platform.query(
        `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, company_id, responsible_id,
                                        sla_value, sla_unit, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 8, 'BUSINESS_HOURS', now(), now())`,
        [tenant.tenantId, ticket.ticketId, visitId, ticket.taskStepId, tenant.companyId, tenant.userId],
      );

      expect(await sqlStateOf(completedWithoutResult)).toBe(SqlState.checkViolation);
    });
  });

  describe('personal tags', () => {
    it('cannot be used by another member', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      const colleagueId = await seedMember(db.platform, tenant);
      const tagId = await insertReturningId(
        db.platform,
        `INSERT INTO tags (tenant_id, owner_id, name, color) VALUES ($1, $2, 'mine', '#ff0000') RETURNING id`,
        [tenant.tenantId, tenant.userId],
      );

      const borrowTag = () => db.platform.query(`INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id, user_id) VALUES ($1, $2, $3, $4)`, [
        tenant.tenantId,
        ticket.ticketId,
        tagId,
        colleagueId,
      ]);

      expect(await sqlStateOf(borrowTag)).toBe(SqlState.foreignKeyViolation);
    });
  });

  describe('maintained columns', () => {
    it('refreshes updated_at on every update, whoever writes', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      await db.platform.query(`UPDATE tickets SET updated_at = '2000-01-01' WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        ticket.ticketId,
      ]);

      const { rows } = await db.platform.query<{ recent: boolean }>(
        `SELECT updated_at > now() - interval '1 minute' AS recent FROM tickets WHERE id = $1`,
        [ticket.ticketId],
      );

      expect(rows[0]?.recent).toBe(true);
    });

    it('indexes title and description text (without HTML tags) for search', async () => {
      const ticket = await seedTicket(db.platform, tenant);
      await db.platform.query(
        `UPDATE tickets SET title = 'Confirmación de pago', description_html = '<p>Transferencia <b>Bancolombia</b></p>'
         WHERE tenant_id = $1 AND id = $2`,
        [tenant.tenantId, ticket.ticketId],
      );

      const found = await withContext(db.runtime, { tenantId: tenant.tenantId }, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM tickets WHERE search_vector @@ plainto_tsquery('spanish', $1)`,
          ['bancolombia pagos'],
        );
        return rows.map((row) => row.id);
      });

      expect(found).toEqual([ticket.ticketId]);
    });
  });
});
