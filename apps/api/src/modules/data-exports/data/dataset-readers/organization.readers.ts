import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, MIN_INT, NIL_UUID } from './dataset-reader.js';

/** Readers of the organization datasets (docs/arquitectura.md §20). */
export const ORGANIZATION_READERS = {
  tenants: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT id, slug, name, status, country_code, time_zone, primary_color, logo_file_id, mfa_required,
             cancelled_at, deletion_requested_at, purge_after, created_at, updated_at
      FROM tenants WHERE id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  companies: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, tax_id, is_default, country_code, currency_code, time_zone, calendar_id,
             is_active, created_at
      FROM companies WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  departments: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, is_active, created_at
      FROM departments WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  positions: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, is_active, created_at
      FROM positions WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  site_levels: {
    start: [MIN_INT],
    page: (tenantId, [level], limit) => Prisma.sql`
      SELECT tenant_id, level, name
      FROM site_levels WHERE tenant_id = ${tenantId}::uuid AND level > ${level}::int
      ORDER BY level LIMIT ${limit}`,
  },
  sites: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, parent_id, level, name, is_central, is_active, created_at
      FROM sites WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  calendars: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, country_code, is_default, created_at
      FROM calendars WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  calendar_working_hours: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, calendar_id, weekday, start_time, end_time
      FROM calendar_working_hours WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  calendar_holidays: {
    start: [NIL_UUID, '-infinity'],
    page: (tenantId, [calendarId, date], limit) => Prisma.sql`
      SELECT tenant_id, calendar_id, date, name
      FROM calendar_holidays WHERE tenant_id = ${tenantId}::uuid AND (calendar_id, date) > (${calendarId}::uuid, ${date}::date)
      ORDER BY calendar_holidays.calendar_id, calendar_holidays.date LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
