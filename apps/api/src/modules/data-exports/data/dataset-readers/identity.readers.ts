import { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { type DatasetReader, NIL_UUID } from './dataset-reader.js';

/** Readers of the identity datasets (docs/arquitectura.md §20). */
export const IDENTITY_READERS = {
  // Users are global: only what the organization knows of its members, never the account's secrets or security state.
  members: {
    start: [NIL_UUID],
    page: (tenantId, [userId], limit) => Prisma.sql`
      SELECT m.tenant_id, m.user_id, u.email, u.first_name, u.last_name, u.document_number, u.status AS account_status,
             u.locale, u.time_zone, m.role_id, m.position_id, m.department_id, m.site_id, m.status,
             m.is_owner, m.signature_file_id, m.joined_at, m.created_at, m.updated_at
      FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.user_id > ${userId}::uuid
      ORDER BY m.user_id LIMIT ${limit}`,
  },
  membership_companies: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [userId, companyId], limit) => Prisma.sql`
      SELECT tenant_id, user_id, company_id
      FROM membership_companies WHERE tenant_id = ${tenantId}::uuid AND (user_id, company_id) > (${userId}::uuid, ${companyId}::uuid)
      ORDER BY user_id, company_id LIMIT ${limit}`,
  },
  roles: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, description, system_role, is_admin, is_active, created_at,
             permissions_version
      FROM roles WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  role_permissions: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [roleId, permissionId], limit) => Prisma.sql`
      SELECT rp.tenant_id, rp.role_id, rp.permission_id, p.action, p.subject, rp.conditions
      FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.tenant_id = ${tenantId}::uuid AND (rp.role_id, rp.permission_id) > (${roleId}::uuid, ${permissionId}::uuid)
      ORDER BY rp.role_id, rp.permission_id LIMIT ${limit}`,
  },
  groups: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, is_active, created_at
      FROM groups WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  group_members: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [groupId, userId], limit) => Prisma.sql`
      SELECT tenant_id, group_id, user_id
      FROM group_members WHERE tenant_id = ${tenantId}::uuid AND (group_id, user_id) > (${groupId}::uuid, ${userId}::uuid)
      ORDER BY group_id, user_id LIMIT ${limit}`,
  },
  approval_group_types: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, name, is_default, created_at
      FROM approval_group_types WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  approval_groups: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, type_id, company_id, name, is_active, created_at
      FROM approval_groups WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
  approval_group_approvers: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [groupId, userId], limit) => Prisma.sql`
      SELECT tenant_id, group_id, user_id, position
      FROM approval_group_approvers WHERE tenant_id = ${tenantId}::uuid AND (group_id, user_id) > (${groupId}::uuid, ${userId}::uuid)
      ORDER BY group_id, user_id LIMIT ${limit}`,
  },
  approval_group_members: {
    start: [NIL_UUID, NIL_UUID],
    page: (tenantId, [groupId, userId], limit) => Prisma.sql`
      SELECT tenant_id, group_id, type_id, company_id, user_id
      FROM approval_group_members WHERE tenant_id = ${tenantId}::uuid AND (group_id, user_id) > (${groupId}::uuid, ${userId}::uuid)
      ORDER BY group_id, user_id LIMIT ${limit}`,
  },
  delegations: {
    start: [NIL_UUID],
    page: (tenantId, [id], limit) => Prisma.sql`
      SELECT tenant_id, id, from_user_id, to_user_id, starts_at, ends_at, reason, created_at
      FROM delegations WHERE tenant_id = ${tenantId}::uuid AND id > ${id}::uuid
      ORDER BY id LIMIT ${limit}`,
  },
} satisfies Partial<Record<ExportDatasetName, DatasetReader>>;
