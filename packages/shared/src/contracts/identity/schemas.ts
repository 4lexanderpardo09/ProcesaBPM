import { z } from 'zod';
import { emailSchema, nameSchema, pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';

const personNameSchema = z.string().trim().min(1).max(100);
const companyIdsSchema = z
  .array(uuidSchema)
  .min(1, 'A member belongs to at least one company')
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Repeated ids');

// ---- Members ----
export const memberStatusSchema = z.enum(['INVITED', 'ACTIVE', 'INACTIVE']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

/** `status` filters one state; without it, deactivated members are hidden unless `includeInactive` is set. */
export const membersQuerySchema = pageQuerySchema.extend({
  roleId: uuidSchema.optional(),
  positionId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  status: memberStatusSchema.optional(),
});
export type MembersQuery = z.infer<typeof membersQuerySchema>;

export const inviteMemberRequestSchema = z.object({
  email: emailSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  roleId: uuidSchema,
  positionId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  companyIds: companyIdsSchema,
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

/** `null` clears a position, department or site; `companyIds` replaces the list (at least one). */
export const updateMemberRequestSchema = z
  .object({
    roleId: uuidSchema,
    positionId: uuidSchema.nullable(),
    departmentId: uuidSchema.nullable(),
    siteId: uuidSchema.nullable(),
    companyIds: companyIdsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const memberResponseSchema = z.object({
  userId: uuidSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: memberStatusSchema,
  isOwner: z.boolean(),
  roleId: uuidSchema,
  positionId: uuidSchema.nullable(),
  departmentId: uuidSchema.nullable(),
  siteId: uuidSchema.nullable(),
  companyIds: z.array(uuidSchema),
  joinedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MemberResponse = z.infer<typeof memberResponseSchema>;

// ---- Roles ----
export const createRoleRequestSchema = z.object({
  name: nameSchema,
  description: z.string().trim().min(1).max(500).optional(),
  isAdmin: z.boolean().optional(),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({ name: nameSchema, description: z.string().trim().min(1).max(500).nullable(), isAdmin: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const systemRoleSchema = z.enum(['ADMIN', 'SUPERVISOR', 'AGENT', 'REQUESTER']);

export const roleResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  systemRole: systemRoleSchema.nullable(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type RoleResponse = z.infer<typeof roleResponseSchema>;

/** One entry of a role's permission list: a catalog permission and, optionally, a condition on the records. */
export const rolePermissionSchema = z.object({
  action: z.string().trim().min(1).max(64),
  subject: z.string().trim().min(1).max(64),
  conditions: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type RolePermissionInput = z.infer<typeof rolePermissionSchema>;

/** Replaces the whole list of the role in one operation. */
export const replaceRolePermissionsRequestSchema = z.object({ permissions: z.array(rolePermissionSchema).max(500) });
export type ReplaceRolePermissionsRequest = z.infer<typeof replaceRolePermissionsRequestSchema>;

export const rolePermissionResponseSchema = z.object({
  action: z.string(),
  subject: z.string(),
  conditions: z.record(z.string(), z.unknown()).nullable(),
});
export type RolePermissionResponse = z.infer<typeof rolePermissionResponseSchema>;

/** The permission catalog grouped by subject, for the role editor. */
export interface PermissionCatalogGroup {
  readonly subject: string;
  /** Whether rules on this subject may carry conditions (its fields are registered). */
  readonly acceptsConditions: boolean;
  readonly actions: ReadonlyArray<{ readonly action: string; readonly description: string | null }>;
}

// ---- Groups ----
export const groupRequestSchema = z.object({ name: nameSchema });
export type GroupRequest = z.infer<typeof groupRequestSchema>;

export const groupResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type GroupResponse = z.infer<typeof groupResponseSchema>;

const userIdListSchema = z
  .array(uuidSchema)
  .max(1000)
  .refine((ids) => new Set(ids).size === ids.length, 'Repeated ids');
export const replaceGroupMembersRequestSchema = z.object({ userIds: userIdListSchema });
export type ReplaceGroupMembersRequest = z.infer<typeof replaceGroupMembersRequestSchema>;

export const addGroupMemberRequestSchema = z.object({ userId: uuidSchema });
export type AddGroupMemberRequest = z.infer<typeof addGroupMemberRequestSchema>;

export const groupMembersResponseSchema = z.object({ userIds: z.array(uuidSchema) });
export type GroupMembersResponse = z.infer<typeof groupMembersResponseSchema>;
