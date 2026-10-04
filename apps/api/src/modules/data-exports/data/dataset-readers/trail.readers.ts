import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, NIL_UUID } from './dataset-reader.js';

/** Readers of the trail datasets (docs/arquitectura.md §20). */
export const TRAIL_READERS = {
  audit_logs: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, actor_id, action, entity_type, entity_id, before, after, ip_address, created_at,
             user_agent, request_id, support_actor_id, support_grant_id
      FROM audit_logs WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  support_access_grants: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, granted_by_id, reason, starts_at, expires_at, revoked_at, revoked_by_id, created_at
      FROM support_access_grants WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  support_sessions: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, grant_id, platform_user_id, platform_user_label, opened_at, closed_at
      FROM support_sessions WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
