import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { insertReturningId, seedDraftWorkflow, seedTenant, seedTicket, type SeededTenant, type SeededTicket, type SeededWorkflow } from './support/fixtures.js';

const SHA = 'c'.repeat(64);

describe('PDF documents: workflow documents, templates and generated files', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let workflow: SeededWorkflow;
  let other: SeededWorkflow;
  let ticket: SeededTicket;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    [workflow, other] = [await seedDraftWorkflow(db.platform, tenant), await seedDraftWorkflow(db.platform, tenant)];
    ticket = await seedTicket(db.platform, tenant);
  });
  afterAll(async () => {
    await db.close();
  });

  const format = (workflowId = workflow.workflowId) =>
    insertReturningId(db.platform, `INSERT INTO pdf_formats (tenant_id, workflow_id, name, design) VALUES ($1, $2, $3, '{"version":1}') RETURNING id`, [tenant.tenantId, workflowId, randomUUID()]);
  const file = async (kind: 'USER' | 'SYSTEM' = 'USER', status = 'CONFIRMED') => {
    const id = randomUUID();
    await db.platform.query(
      `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin, status, confirmed_at, uploaded_by_id)
       VALUES ($1::uuid, $2::uuid, 'tenants/' || $1::text || '/2026/10/' || $2::text, 'a.pdf', 'application/pdf', 1000, $3, $4::file_origin, $5::file_status, now(), $6)`,
      [tenant.tenantId, id, SHA, kind, status, kind === 'USER' ? tenant.userId : null],
    );
    return id;
  };
  const template = async (workflowId = workflow.workflowId, companyId: string | null = null) =>
    insertReturningId(db.platform, `INSERT INTO pdf_templates (tenant_id, workflow_id, company_id, file_id, name, pages) VALUES ($1, $2, $3, $4, $5, '[{"mediaBox":{"x":0,"y":0,"w":595,"h":842},"rotation":0}]') RETURNING id`, [tenant.tenantId, workflowId, companyId, await file(), randomUUID()]);
  const workflowDocument = (formatId: string, moment: string | null, workflowId = workflow.workflowId, companyId: string | null = null, active = true) =>
    db.platform.query(`INSERT INTO workflow_documents (tenant_id, workflow_id, company_id, kind, format_id, moment, is_active) VALUES ($1, $2, $3, 'DESIGNED', $4, $5::document_moment, $6)`, [tenant.tenantId, workflowId, companyId, formatId, moment, active]);

  describe('workflow documents', () => {
    it('allow no moment (block-only) and as many block-only documents as wanted', async () => {
      await workflowDocument(await format(), null);
      await workflowDocument(await format(), null);
    });

    it('one active document per moment and company; a deactivated one does not count', async () => {
      const isolated = await seedDraftWorkflow(db.platform, tenant);
      await workflowDocument(await format(isolated.workflowId), 'CLOSING', isolated.workflowId);
      expect(await sqlStateOf(async () => workflowDocument(await format(isolated.workflowId), 'CLOSING', isolated.workflowId))).toBe(SqlState.uniqueViolation);
      await workflowDocument(await format(isolated.workflowId), 'CLOSING', isolated.workflowId, null, false);
      await workflowDocument(await format(isolated.workflowId), 'CREATION', isolated.workflowId);
    });

    it('cannot use a format or template of another workflow, or of another company', async () => {
      expect(await sqlStateOf(async () => workflowDocument(await format(other.workflowId), 'CREATION'))).toBe(SqlState.checkViolation);
      const companyB = await insertReturningId(db.platform, `INSERT INTO companies (tenant_id, name, country_code, currency_code, time_zone) SELECT tenant_id, 'B', country_code, currency_code, time_zone FROM companies WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenant.tenantId, tenant.companyId]);
      const bound = await template(workflow.workflowId, companyB);
      const useIt = () => db.platform.query(`INSERT INTO workflow_documents (tenant_id, workflow_id, company_id, kind, template_id, moment) VALUES ($1, $2, $3, 'TEMPLATE', $4, 'EACH_STEP')`, [tenant.tenantId, workflow.workflowId, tenant.companyId, bound]);
      expect(await sqlStateOf(useIt)).toBe(SqlState.checkViolation);
    });
  });

  describe('templates and formats', () => {
    it('a design is a JSON object and the pages are a list of 1 to 50', async () => {
      const badDesign = () => db.platform.query(`INSERT INTO pdf_formats (tenant_id, workflow_id, name, design) VALUES ($1, $2, 'x', '[]')`, [tenant.tenantId, workflow.workflowId]);
      expect(await sqlStateOf(badDesign)).toBe(SqlState.checkViolation);
      const noPages = async () => db.platform.query(`INSERT INTO pdf_templates (tenant_id, workflow_id, file_id, name, pages) VALUES ($1, $2, $3, 'x', '[]')`, [tenant.tenantId, workflow.workflowId, await file()]);
      expect(await sqlStateOf(noPages)).toBe(SqlState.checkViolation);
    });

    it('field and signature geometry is sane', async () => {
      const templateId = await template();
      const field = (extra: string) => db.platform.query(`INSERT INTO pdf_template_fields (tenant_id, template_id, mode, field_code, page, x, y, ${extra.split('=')[0]}) VALUES ($1, $2, 'COORDINATES', 'X', 1, 10, 10, ${extra.split('=')[1]})`, [tenant.tenantId, templateId]);
      await field('font_size=10');
      expect(await sqlStateOf(() => field('font_size=2'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => field("align='MIDDLE'"))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => field('max_width=0'))).toBe(SqlState.checkViolation);
      const signature = (width: number) => db.platform.query(`INSERT INTO pdf_template_signatures (tenant_id, template_id, mode, step_name, signer_type, page, x, y, width, height) VALUES ($1, $2, 'COORDINATES', 'Review', 'CREATOR', 1, 10, 10, $3, 30)`, [tenant.tenantId, templateId, width]);
      await signature(100);
      expect(await sqlStateOf(() => signature(0))).toBe(SqlState.checkViolation);
      const withoutPosition = () => db.platform.query(`INSERT INTO pdf_template_signatures (tenant_id, template_id, mode, step_name, signer_type, page, width, height) VALUES ($1, $2, 'COORDINATES', 'Review', 'CREATOR', 1, 100, 30)`, [tenant.tenantId, templateId]);
      expect(await sqlStateOf(withoutPosition)).toBe(SqlState.checkViolation);
    });

    it('updated_at is maintained for templates', async () => {
      const id = await template();
      await db.platform.query(`UPDATE pdf_templates SET updated_at = '2020-01-01' WHERE id = $1`, [id]);
      await db.platform.query(`UPDATE pdf_templates SET name = 'renamed' WHERE id = $1`, [id]);
      expect((await db.platform.query<{ fresh: boolean }>(`SELECT updated_at > now() - interval '1 minute' AS fresh FROM pdf_templates WHERE id = $1`, [id])).rows[0]!.fresh).toBe(true);
    });
  });

  describe('generated documents', () => {
    const attach = (fileId: string, role: string, stepId: string | null, version = 1) =>
      db.platform.query(`INSERT INTO ticket_documents (tenant_id, ticket_id, file_id, role, step_id, version) VALUES ($1, $2, $3, $4::ticket_document_role, $5, $6)`, [tenant.tenantId, ticket.ticketId, fileId, role, stepId, version]);

    it('a step document needs its step and the main document has none', async () => {
      expect(await sqlStateOf(async () => attach(await file('SYSTEM'), 'STEP_DOCUMENT', null))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(async () => attach(await file('SYSTEM'), 'MAIN_DOCUMENT', ticket.taskStepId))).toBe(SqlState.checkViolation);
      await attach(await file('SYSTEM'), 'STEP_DOCUMENT', ticket.taskStepId);
    });

    it('one file is the document of one version only; a new version retires the old one first', async () => {
      const first = await file('SYSTEM');
      await attach(first, 'MAIN_DOCUMENT', null, 1);
      expect(await sqlStateOf(() => attach(first, 'MAIN_DOCUMENT', null, 2))).toBe(SqlState.uniqueViolation);
      const second = await file('SYSTEM');
      expect(await sqlStateOf(() => attach(second, 'MAIN_DOCUMENT', null, 2))).toBe(SqlState.uniqueViolation);
      await db.platform.query(`UPDATE ticket_documents SET is_current = false WHERE tenant_id = $1 AND ticket_id = $2 AND role = 'MAIN_DOCUMENT'`, [tenant.tenantId, ticket.ticketId]);
      await attach(second, 'MAIN_DOCUMENT', null, 2);
    });

    it('system files are made by the platform: no uploader, and at most 50 MB', async () => {
      const insert = (uploader: string | null, size: number) => {
        const id = randomUUID();
        return db.platform.query(
          `INSERT INTO stored_files (tenant_id, id, storage_key, original_name, mime_type, size_bytes, sha256, origin, status, confirmed_at, uploaded_by_id)
           VALUES ($1::uuid, $2::uuid, 'tenants/' || $1::text || '/2026/10/' || $2::text, 'a.pdf', 'application/pdf', $3, $4, 'SYSTEM', 'CONFIRMED', now(), $5)`,
          [tenant.tenantId, id, size, SHA, uploader],
        );
      };
      await insert(null, 50 * 1024 * 1024);
      expect(await sqlStateOf(() => insert(null, 50 * 1024 * 1024 + 1))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => insert(tenant.userId, 10))).toBe(SqlState.checkViolation);
    });
  });
});
