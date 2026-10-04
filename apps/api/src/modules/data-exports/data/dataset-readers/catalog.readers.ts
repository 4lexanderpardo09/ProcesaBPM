import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, NIL_UUID } from './dataset-reader.js';

/** Readers of the catalog datasets (docs/arquitectura.md §20). */
export const CATALOG_READERS = {
  priorities: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, sort_order, color, is_active
      FROM priorities WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  categories: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, is_active, created_at
      FROM categories WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  category_companies: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [categoryId, companyId], limit) => Prisma.sql`
      SELECT tenant_id, category_id, company_id
      FROM category_companies WHERE tenant_id = ${tenantId}::uuid AND (category_id, company_id) > (${categoryId}::uuid, ${companyId}::uuid)
      ORDER BY category_id, company_id LIMIT ${limit}`,
  },
  category_departments: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [categoryId, departmentId], limit) => Prisma.sql`
      SELECT tenant_id, category_id, department_id
      FROM category_departments WHERE tenant_id = ${tenantId}::uuid AND (category_id, department_id) > (${categoryId}::uuid, ${departmentId}::uuid)
      ORDER BY category_id, department_id LIMIT ${limit}`,
  },
  subcategories: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, category_id, default_priority_id, name, description, is_active, created_at
      FROM subcategories WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  error_types: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, description, is_process_error, forces_close, is_reopening, is_active
      FROM error_types WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  error_subtypes: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, error_type_id, name, description, is_active
      FROM error_subtypes WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  tags: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, owner_id, name, color
      FROM tags WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  calculator_configs: {
    start: [''],
    page: (tenantId, [code], limit) => Prisma.sql`
      SELECT tenant_id, code, config, updated_at
      FROM calculator_configs WHERE tenant_id = ${tenantId}::uuid AND code > ${code}::text
      ORDER BY code LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
