import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, NIL_UUID } from './dataset-reader.js';

/** Readers of the workflows datasets (docs/arquitectura.md §20). */
export const WORKFLOWS_READERS = {
  workflows: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, subcategory_id, name, is_active, created_at
      FROM workflows WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  workflow_observers: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, participant_type::text AS participant_type, user_id, position_id, group_id
      FROM workflow_observers WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  workflow_versions: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, number, status::text AS status, notes, published_at, published_by_id,
             created_at, revision
      FROM workflow_versions WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  steps: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, version_id, type::text AS type, name, description,
             assignment_mode::text AS assignment_mode, manual_selection, site_scope::text AS site_scope,
             position_id, approval_group_type_id, approval_level, close_rule::text AS close_rule, sla_value,
             sla_unit::text AS sla_unit, deadline_type::text AS deadline_type, deadline_field_code,
             deadline_business_days, max_loops, dispatch_interval_min, allows_batch, config, ui_x, ui_y
      FROM steps WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  step_candidates: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, step_id, participant_type::text AS participant_type, user_id, position_id, group_id
      FROM step_candidates WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  step_initiators: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, step_id, participant_type::text AS participant_type, user_id, position_id, group_id,
             department_id, company_id, site_id
      FROM step_initiators WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  step_sla_overrides: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [stepId, companyId], limit) => Prisma.sql`
      SELECT tenant_id, step_id, company_id, sla_value, sla_unit::text AS sla_unit
      FROM step_sla_overrides WHERE tenant_id = ${tenantId}::uuid AND (step_id, company_id) > (${stepId}::uuid, ${companyId}::uuid)
      ORDER BY step_id, company_id LIMIT ${limit}`,
  },
  step_signers: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, step_id, signer_type::text AS signer_type, user_id, position_id, label, sort_order
      FROM step_signers WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  step_files: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [stepId, fileId], limit) => Prisma.sql`
      SELECT tenant_id, step_id, file_id, label, sort_order
      FROM step_files WHERE tenant_id = ${tenantId}::uuid AND (step_id, file_id) > (${stepId}::uuid, ${fileId}::uuid)
      ORDER BY step_id, file_id LIMIT ${limit}`,
  },
  transitions: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, version_id, from_step_id, to_step_id, type::text AS type, label, condition, sort_order,
             ui_points
      FROM transitions WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  fields: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, version_id, step_id, code, label, type::text AS type, capture::text AS capture,
             is_required, is_read_only, sort_order, config, data_source
      FROM fields WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  amount_rules: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, version_id, step_id, position_id, company_id, field_code, row_type_value,
             amount_column, type_column, max_amount::text AS max_amount, currency_code, action::text AS action,
             approval_step_id, message, is_active
      FROM amount_rules WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  company_cutoffs: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, company_id, cutoff_day, grace_business_days, description, is_active
      FROM company_cutoffs WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  datasets: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, name, columns, source_file_name, loaded_at, is_active
      FROM datasets WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  dataset_rows: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, dataset_id, lookup_key, data
      FROM dataset_rows WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  pdf_formats: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, name, description, design, file_name_pattern, updated_by_id, is_active,
             created_at, updated_at
      FROM pdf_formats WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  pdf_templates: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, company_id, file_id, name, pages, has_acroform, is_active, created_at,
             acroform_fields, updated_at
      FROM pdf_templates WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  pdf_template_fields: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, template_id, mode::text AS mode, field_code, expression, acroform_name, page, x, y,
             font_size, max_width, align
      FROM pdf_template_fields WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  pdf_template_signatures: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, template_id, mode::text AS mode, step_name, signer_type::text AS signer_type,
             signer_label, acroform_name, page, x, y, width, height
      FROM pdf_template_signatures WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  workflow_documents: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, workflow_id, company_id, kind::text AS kind, format_id, template_id,
             moment::text AS moment, is_active
      FROM workflow_documents WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  text_templates: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, owner_id, title, body_html, created_at, updated_at
      FROM text_templates WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  text_template_shares: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [templateId, userId], limit) => Prisma.sql`
      SELECT tenant_id, template_id, user_id
      FROM text_template_shares WHERE tenant_id = ${tenantId}::uuid AND (template_id, user_id) > (${templateId}::uuid, ${userId}::uuid)
      ORDER BY template_id, user_id LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
