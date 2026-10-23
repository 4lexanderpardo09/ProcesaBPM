import {
  approvalGroupTypeResponseSchema,
  approvalMembersResponseSchema,
  approversResponseSchema,
  groupResponseSchema,
  companyResponseSchema,
  type CreateDelegationRequest,
  delegationResponseSchema,
  groupMembersResponseSchema,
  type InviteMemberRequest,
  type MemberStatus,
  memberResponseSchema,
  namedRecordResponseSchema,
  pageResponseSchema,
  type RolePermissionInput,
  roleResponseSchema,
  rolePermissionResponseSchema,
  signatureResponseSchema,
  siteResponseSchema,
  type UpdateMemberRequest,
} from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { ADMIN_PAGE_SIZE, adminQueryKeys } from '@/shared/admin/admin-api';

/** The API's largest page: an organization has fewer roles, departments, positions, sites or companies than this. */
const ALL = 100;

const allOf = <TItem extends z.ZodType>(client: HttpClient, path: string, item: TItem) =>
  queryOptions({
    queryKey: [...adminQueryKeys.all, path, 'all'] as const,
    queryFn: ({ signal }) => client.request(`${path}?pageSize=${String(ALL)}&includeInactive=true`, { schema: pageResponseSchema(item), signal }),
    select: (page) => page.items,
  });

/** Every role, the deactivated ones too (a member may still have one). */
export const rolesQueryOptions = (client: HttpClient) => allOf(client, '/roles', roleResponseSchema);
export const departmentsQueryOptions = (client: HttpClient) => allOf(client, '/departments', namedRecordResponseSchema);
export const positionsQueryOptions = (client: HttpClient) => allOf(client, '/positions', namedRecordResponseSchema);
export const sitesQueryOptions = (client: HttpClient) => allOf(client, '/sites', siteResponseSchema);
export const companiesQueryOptions = (client: HttpClient) => allOf(client, '/companies', companyResponseSchema);
export const groupsQueryOptions = (client: HttpClient) => allOf(client, '/groups', groupResponseSchema);

export interface MembersParams {
  readonly page: number;
  readonly search: string;
  readonly roleId: string;
  /** Empty: the invited and active ones. */
  readonly status: MemberStatus | '';
}

/** One page of members with the filters of the list. */
export function membersQueryOptions(client: HttpClient, { page, search, roleId, status }: MembersParams) {
  const params: Record<string, string> = { page: String(page), pageSize: String(ADMIN_PAGE_SIZE) };
  if (search !== '') params['search'] = search;
  if (roleId !== '') params['roleId'] = roleId;
  if (status !== '') params['status'] = status;
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/members', params] as const,
    queryFn: ({ signal }) => client.request(`/members?${new URLSearchParams(params).toString()}`, { schema: pageResponseSchema(memberResponseSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

/** One member, to name the people of a group. */
export function memberQueryOptions(client: HttpClient, userId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/members', userId] as const,
    queryFn: ({ signal }) => client.request(`/members/${encodeURIComponent(userId)}`, { schema: memberResponseSchema, signal }),
    staleTime: 60_000,
  });
}

/** The person gets an e-mail with a one-time link to join (and to set a password if they are new). */
export function inviteMember(client: HttpClient, request: InviteMemberRequest) {
  return client.request('/members/invitations', { method: 'POST', body: request, schema: memberResponseSchema });
}

export function updateMember(client: HttpClient, userId: string, request: UpdateMemberRequest) {
  return client.request(`/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: request, schema: memberResponseSchema });
}

/** A short-lived link to the member's signature, or null when they have none. */
export function memberSignatureQueryOptions(client: HttpClient, userId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/members', userId, 'signature'] as const,
    queryFn: ({ signal }) => client.request(`/members/${encodeURIComponent(userId)}/signature`, { schema: signatureResponseSchema.nullish().transform((signature) => signature ?? null), signal }),
  });
}

/** Makes an image the caller uploaded the member's signature. */
export function setMemberSignature(client: HttpClient, userId: string, fileId: string) {
  return client.request(`/members/${encodeURIComponent(userId)}/signature`, { method: 'PUT', body: { fileId } });
}

export function clearMemberSignature(client: HttpClient, userId: string) {
  return client.request(`/members/${encodeURIComponent(userId)}/signature`, { method: 'DELETE' });
}

/** A new link; the earlier ones keep working until they expire. */
export function resendInvitation(client: HttpClient, userId: string) {
  return client.request(`/members/${encodeURIComponent(userId)}/resend-invitation`, { method: 'POST', schema: memberResponseSchema });
}

const permissionCatalogSchema = z.array(
  z.object({
    subject: z.string(),
    acceptsConditions: z.boolean(),
    actions: z.array(z.object({ action: z.string(), description: z.string().nullable() })),
  }),
);
export type PermissionCatalog = z.infer<typeof permissionCatalogSchema>;

/** The permissions a role can be given, by subject. */
export function permissionCatalogQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['permission-catalog'] as const,
    queryFn: ({ signal }) => client.request('/permissions', { schema: permissionCatalogSchema, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function rolePermissionsQueryOptions(client: HttpClient, roleId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/roles', roleId, 'permissions'] as const,
    queryFn: ({ signal }) => client.request(`/roles/${encodeURIComponent(roleId)}/permissions`, { schema: z.array(rolePermissionResponseSchema), signal }),
  });
}

/** Replaces the whole list; the API only lets a person give permissions their own role has. */
export function replaceRolePermissions(client: HttpClient, roleId: string, permissions: readonly RolePermissionInput[]) {
  return client.request(`/roles/${encodeURIComponent(roleId)}/permissions`, { method: 'PUT', body: { permissions }, schema: z.array(rolePermissionResponseSchema) });
}

/** Base roles and roles that still have members cannot go (the API refuses them). */
export function deleteRole(client: HttpClient, roleId: string) {
  return client.request(`/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
}

export function groupMembersQueryOptions(client: HttpClient, groupId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/groups', groupId, 'members'] as const,
    queryFn: ({ signal }) => client.request(`/groups/${encodeURIComponent(groupId)}/members`, { schema: groupMembersResponseSchema, signal }),
    select: (members) => members.userIds,
  });
}

export function addGroupMember(client: HttpClient, groupId: string, userId: string) {
  return client.request(`/groups/${encodeURIComponent(groupId)}/members`, { method: 'POST', body: { userId } });
}

export function removeGroupMember(client: HttpClient, groupId: string, userId: string) {
  return client.request(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function approvalTypesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/approval-group-types', 'all'] as const,
    queryFn: ({ signal }) => client.request(`/approval-group-types?pageSize=${String(ALL)}`, { schema: pageResponseSchema(approvalGroupTypeResponseSchema), signal }),
    select: (page) => page.items,
  });
}

/** The type in use by a group or a workflow step, and the default one, are kept (the API refuses them). */
export function deleteApprovalType(client: HttpClient, typeId: string) {
  return client.request(`/approval-group-types/${encodeURIComponent(typeId)}`, { method: 'DELETE' });
}

/** In order: the first is the primary approver, the others substitute them in turn. */
export function approversQueryOptions(client: HttpClient, groupId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/approval-groups', groupId, 'approvers'] as const,
    queryFn: ({ signal }) => client.request(`/approval-groups/${encodeURIComponent(groupId)}/approvers`, { schema: approversResponseSchema, signal }),
    select: (response) => [...response.approvers].sort((a, b) => a.position - b.position).map((approver) => approver.userId),
  });
}

export function replaceApprovers(client: HttpClient, groupId: string, userIds: readonly string[]) {
  return client.request(`/approval-groups/${encodeURIComponent(groupId)}/approvers`, { method: 'PUT', body: { userIds }, schema: approversResponseSchema });
}

/** The people whose requests this group approves. */
export function approvalMembersQueryOptions(client: HttpClient, groupId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/approval-groups', groupId, 'members'] as const,
    queryFn: ({ signal }) => client.request(`/approval-groups/${encodeURIComponent(groupId)}/members`, { schema: approvalMembersResponseSchema, signal }),
    select: (response) => response.userIds,
  });
}

export function addApprovalMember(client: HttpClient, groupId: string, userId: string) {
  return client.request(`/approval-groups/${encodeURIComponent(groupId)}/members`, { method: 'POST', body: { userId } });
}

export function removeApprovalMember(client: HttpClient, groupId: string, userId: string) {
  return client.request(`/approval-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

/** One page of delegations; `current` keeps only the ones in force now or still to come. */
export function delegationsQueryOptions(client: HttpClient, page: number, current: boolean) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(ADMIN_PAGE_SIZE), current: String(current) });
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/delegations', page, current] as const,
    queryFn: ({ signal }) => client.request(`/delegations?${params.toString()}`, { schema: pageResponseSchema(delegationResponseSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

export function createDelegation(client: HttpClient, request: CreateDelegationRequest) {
  return client.request('/delegations', { method: 'POST', body: request, schema: delegationResponseSchema });
}

/** A delegation still to come is removed; one in force ends now. */
export function cancelDelegation(client: HttpClient, delegationId: string) {
  return client.request(`/delegations/${encodeURIComponent(delegationId)}/cancel`, { method: 'POST' });
}
