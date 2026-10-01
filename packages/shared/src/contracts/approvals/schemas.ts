import { z } from 'zod';
import { nameSchema, pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';
import { MAX_APPROVAL_LEVEL } from './types.js';

// ---- Group types ----
export const approvalGroupTypeRequestSchema = z.object({ name: nameSchema });
export type ApprovalGroupTypeRequest = z.infer<typeof approvalGroupTypeRequestSchema>;

export const approvalGroupTypeResponseSchema = z.object({ id: uuidSchema, name: z.string(), isDefault: z.boolean(), createdAt: z.string() });
export type ApprovalGroupTypeResponse = z.infer<typeof approvalGroupTypeResponseSchema>;

// ---- Groups ----
export const approvalGroupsQuerySchema = pageQuerySchema.extend({ typeId: uuidSchema.optional(), companyId: uuidSchema.optional() });
export type ApprovalGroupsQuery = z.infer<typeof approvalGroupsQuerySchema>;

/** A group with no company applies to every company; the type and company cannot change afterwards. */
export const createApprovalGroupRequestSchema = z.object({ typeId: uuidSchema, companyId: uuidSchema.optional(), name: nameSchema });
export type CreateApprovalGroupRequest = z.infer<typeof createApprovalGroupRequestSchema>;

export const renameApprovalGroupRequestSchema = z.object({ name: nameSchema });
export type RenameApprovalGroupRequest = z.infer<typeof renameApprovalGroupRequestSchema>;

export const approvalGroupResponseSchema = z.object({
  id: uuidSchema,
  typeId: uuidSchema,
  companyId: uuidSchema.nullable(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type ApprovalGroupResponse = z.infer<typeof approvalGroupResponseSchema>;

const userIdsSchema = (max: number) =>
  z
    .array(uuidSchema)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Repeated ids');

/** The order of the list is the order of approval: the first is the primary approver, the rest substitutes. */
export const replaceApproversRequestSchema = z.object({ userIds: userIdsSchema(50) });
export type ReplaceApproversRequest = z.infer<typeof replaceApproversRequestSchema>;

export const approversResponseSchema = z.object({ approvers: z.array(z.object({ userId: uuidSchema, position: z.number().int().min(1) })) });
export type ApproversResponse = z.infer<typeof approversResponseSchema>;

export const replaceApprovalMembersRequestSchema = z.object({ userIds: userIdsSchema(2000) });
export type ReplaceApprovalMembersRequest = z.infer<typeof replaceApprovalMembersRequestSchema>;

export const addApprovalMemberRequestSchema = z.object({ userId: uuidSchema });
export type AddApprovalMemberRequest = z.infer<typeof addApprovalMemberRequestSchema>;

export const approvalMembersResponseSchema = z.object({ userIds: z.array(uuidSchema) });
export type ApprovalMembersResponse = z.infer<typeof approvalMembersResponseSchema>;

// ---- Delegations ----
export const delegationsQuerySchema = pageQuerySchema.pick({ page: true, pageSize: true }).extend({
  fromUserId: uuidSchema.optional(),
  toUserId: uuidSchema.optional(),
  /** Only the ones in force now or in the future. */
  current: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type DelegationsQuery = z.infer<typeof delegationsQuerySchema>;

/** Without `fromUserId` the delegation is the caller's own. */
export const createDelegationRequestSchema = z
  .object({
    fromUserId: uuidSchema.optional(),
    toUserId: uuidSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => new Date(value.startsAt) < new Date(value.endsAt), { message: 'The delegation must end after it starts', path: ['endsAt'] })
  .refine((value) => value.fromUserId !== value.toUserId, { message: 'Nobody delegates to themselves', path: ['toUserId'] });
export type CreateDelegationRequest = z.infer<typeof createDelegationRequestSchema>;

export const delegationResponseSchema = z.object({
  id: uuidSchema,
  fromUserId: uuidSchema,
  toUserId: uuidSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type DelegationResponse = z.infer<typeof delegationResponseSchema>;

// ---- Approver resolution (diagnostics) ----
export const resolveApproverQuerySchema = z.object({
  userId: uuidSchema,
  typeId: uuidSchema,
  companyId: uuidSchema,
  level: z.coerce.number().int().min(1).max(MAX_APPROVAL_LEVEL).default(1),
  /** Instant to resolve for (delegations in force then); defaults to now. */
  at: z.iso.datetime({ offset: true }).optional(),
});
export type ResolveApproverQuery = z.infer<typeof resolveApproverQuerySchema>;
