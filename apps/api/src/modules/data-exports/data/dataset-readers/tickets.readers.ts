import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, NIL_UUID } from './dataset-reader.js';

/** Readers of the tickets datasets (docs/arquitectura.md §20). */
export const TICKETS_READERS = {
  tickets: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, number, workflow_id, workflow_version_id, subcategory_id, priority_id, company_id,
             department_id, site_id, creator_id, registered_by_id, title, description_html, status,
             current_step_id, current_loop, closed_at, closed_by_id, forced_close, created_at, updated_at,
             deleted_at
      FROM tickets WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_assignees: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [ticketId, userId], limit) => Prisma.sql`
      SELECT tenant_id, ticket_id, user_id, type, assigned_at
      FROM ticket_assignees WHERE tenant_id = ${tenantId}::uuid AND (ticket_id, user_id) > (${ticketId}::uuid, ${userId}::uuid)
      ORDER BY ticket_id, user_id LIMIT ${limit}`,
  },
  ticket_field_values: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [ticketId, fieldId], limit) => Prisma.sql`
      SELECT tenant_id, ticket_id, workflow_version_id, field_id, value, updated_by_id, updated_at
      FROM ticket_field_values WHERE tenant_id = ${tenantId}::uuid AND (ticket_id, field_id) > (${ticketId}::uuid, ${fieldId}::uuid)
      ORDER BY ticket_id, field_id LIMIT ${limit}`,
  },
  ticket_events: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, type, step_id, transition_id, loop, actor_id, assignee_id,
             comment_html, data, created_at, seq
      FROM ticket_events WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_step_visits: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, step_id, loop, entered_at, exited_at, exit_transition_id, sla_value,
             sla_unit, calendar_id, due_at, paused_minutes, business_minutes,
             result, resume_at, resume_enqueued_at
      FROM ticket_step_visits WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_sla_clocks: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, visit_id, step_id, loop, company_id, responsible_id, sla_value,
             sla_unit, calendar_id, started_at, due_at, paused_at, paused_minutes, completed_at,
             business_minutes, result, alerted_at, completion_reason
      FROM ticket_sla_clocks WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_parallel_tasks: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, step_id, loop, user_id, status, comment, completed_at,
             created_at
      FROM ticket_parallel_tasks WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_incidents: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, step_id, created_by_id, assigned_to_id, description, resolution,
             status, previous_assignee_ids, opened_at, resolved_at
      FROM ticket_incidents WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_errors: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, error_type_id, error_subtype_id, reporter_id, responsible_id, description,
             is_process_error, created_at
      FROM ticket_errors WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_tags: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [ticketId, tagId], limit) => Prisma.sql`
      SELECT tenant_id, ticket_id, tag_id, user_id, created_at
      FROM ticket_tags WHERE tenant_id = ${tenantId}::uuid AND (ticket_id, tag_id) > (${ticketId}::uuid, ${tagId}::uuid)
      ORDER BY ticket_id, tag_id LIMIT ${limit}`,
  },
  ticket_signatures: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, step_id, loop, user_id, file_id, is_parallel, signed_at
      FROM ticket_signatures WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  ticket_documents: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, ticket_id, file_id, role, event_id, step_id, field_code, version,
             is_current, created_at, deleted_at
      FROM ticket_documents WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  stored_files: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, company_id, original_name, mime_type, size_bytes, sha256, origin,
             status, uploaded_by_id, created_at, confirmed_at, deleted_at, linked_at
      FROM stored_files WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
