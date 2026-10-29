import {
  backupCodesResponseSchema,
  type ChangePasswordRequest,
  delegationResponseSchema,
  directoryPersonSchema,
  type DisableMfaRequest,
  MEMBER_DIRECTORY_LIMIT,
  meResponseSchema,
  mfaEnrollmentSchema,
  mfaStatusResponseSchema,
  notificationTypeSchema,
  type NotificationTypeValue,
  pageResponseSchema,
  signatureResponseSchema,
  tagResponseSchema,
  textTemplateResponseSchema,
  type UpdateProfileRequest,
  uuidSchema,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

export const profileQueryKeys = {
  mfa: ['profile', 'mfa'] as const,
  signature: ['profile', 'signature'] as const,
};

/** Name and time zone; the e-mail is not changed here. */
export function updateProfile(client: HttpClient, request: UpdateProfileRequest) {
  return client.request('/auth/me', { method: 'PATCH', body: request, schema: meResponseSchema });
}

export function changePassword(client: HttpClient, request: ChangePasswordRequest) {
  return client.request('/auth/password', { method: 'POST', body: request });
}

export function mfaStatusQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: profileQueryKeys.mfa, queryFn: ({ signal }) => client.request('/auth/mfa', { schema: mfaStatusResponseSchema, signal }) });
}

/** A new secret to scan; nothing changes until a code from the app confirms it. */
export function beginMfaEnrollment(client: HttpClient) {
  return client.request('/auth/mfa/enrollment', { method: 'POST', schema: mfaEnrollmentSchema });
}

/** Also asks for the password: a stolen session alone cannot take over the second factor. */
export function confirmMfaEnrollment(client: HttpClient, code: string, currentPassword: string) {
  return client.request('/auth/mfa/enrollment/confirm', { method: 'POST', body: { code, currentPassword }, schema: backupCodesResponseSchema });
}

export function disableMfa(client: HttpClient, request: DisableMfaRequest) {
  return client.request('/auth/mfa/disable', { method: 'POST', body: request });
}

/** New backup codes replace the old ones, which stop working. */
export function regenerateBackupCodes(client: HttpClient, code: string) {
  return client.request('/auth/mfa/backup-codes', { method: 'POST', body: { code }, schema: backupCodesResponseSchema });
}

/** A short-lived link to the person's signature image, or null when there is none. */
export function signatureQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: profileQueryKeys.signature,
    // "None" comes back as an empty body, which the client reads as `undefined`.
    queryFn: ({ signal }) => client.request('/auth/me/signature', { schema: signatureResponseSchema.nullish().transform((signature) => signature ?? null), signal }),
  });
}

/** Points the signature at an image already uploaded and confirmed. */
export function setSignature(client: HttpClient, fileId: string) {
  return client.request('/auth/me/signature', { method: 'PUT', body: { fileId } });
}

export function clearSignature(client: HttpClient) {
  return client.request('/auth/me/signature', { method: 'DELETE' });
}

export const toolsQueryKeys = {
  preferences: ['profile', 'notification-preferences'] as const,
  tags: ['tags'] as const,
  templates: ['text-templates'] as const,
  templateShares: (templateId: string) => ['text-templates', templateId, 'shares'] as const,
  delegations: ['profile', 'delegations'] as const,
  directory: ['member-directory'] as const,
};

const preferenceSchema = z.object({ type: notificationTypeSchema, inApp: z.boolean(), email: z.boolean(), emailLocked: z.boolean() });

/** One row per kind of notification, with both channels. */
export function preferencesQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: toolsQueryKeys.preferences, queryFn: ({ signal }) => client.request('/notifications/preferences', { schema: z.array(preferenceSchema), signal }) });
}

export function savePreference(client: HttpClient, type: NotificationTypeValue, channels: { inApp: boolean; email: boolean }) {
  return client.request(`/notifications/preferences/${type}`, { method: 'PUT', body: channels, schema: preferenceSchema });
}

/** The person's own tags (nobody else sees them). */
export function tagsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: toolsQueryKeys.tags, queryFn: ({ signal }) => client.request('/tags', { schema: z.array(tagResponseSchema), signal }) });
}

export function saveTag(client: HttpClient, tagId: string | undefined, body: { name: string; color: string }) {
  return tagId === undefined ? client.request('/tags', { method: 'POST', body, schema: tagResponseSchema }) : client.request(`/tags/${encodeURIComponent(tagId)}`, { method: 'PATCH', body, schema: tagResponseSchema });
}

/** The tag also leaves every ticket it was on. */
export function deleteTag(client: HttpClient, tagId: string) {
  return client.request(`/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
}

/** The person's own templates and the ones shared with them (read only). */
export function templatesQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: toolsQueryKeys.templates, queryFn: ({ signal }) => client.request('/text-templates', { schema: z.array(textTemplateResponseSchema), signal }) });
}

export function saveTemplate(client: HttpClient, templateId: string | undefined, body: { title: string; bodyHtml: string }) {
  return templateId === undefined
    ? client.request('/text-templates', { method: 'POST', body, schema: textTemplateResponseSchema })
    : client.request(`/text-templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body, schema: textTemplateResponseSchema });
}

export function deleteTemplate(client: HttpClient, templateId: string) {
  return client.request(`/text-templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' });
}

export function templateSharesQueryOptions(client: HttpClient, templateId: string) {
  return queryOptions({ queryKey: toolsQueryKeys.templateShares(templateId), queryFn: ({ signal }) => client.request(`/text-templates/${encodeURIComponent(templateId)}/shares`, { schema: z.array(uuidSchema), signal }) });
}

/** Who else may read the template: the whole list, replaced. */
export function setTemplateShares(client: HttpClient, templateId: string, userIds: readonly string[]) {
  return client.request(`/text-templates/${encodeURIComponent(templateId)}/shares`, { method: 'PUT', body: { userIds }, schema: z.array(uuidSchema) });
}

/** The person's delegations in force or still to come, given and received (the API shows a member only theirs). */
export function myDelegationsQueryOptions(client: HttpClient, userId: string) {
  return queryOptions({
    queryKey: [...toolsQueryKeys.delegations, userId] as const,
    queryFn: async ({ signal }) => {
      const page = (filter: string) => client.request(`/delegations?current=true&pageSize=100&${filter}=${encodeURIComponent(userId)}`, { schema: pageResponseSchema(delegationResponseSchema), signal });
      const [given, received] = await Promise.all([page('fromUserId'), page('toUserId')]);
      return { given: given.items, received: received.items };
    },
  });
}

export function createOwnDelegation(client: HttpClient, body: { toUserId: string; startsAt: string; endsAt: string; reason?: string }) {
  return client.request('/delegations', { method: 'POST', body, schema: delegationResponseSchema });
}

export function cancelOwnDelegation(client: HttpClient, delegationId: string) {
  return client.request(`/delegations/${encodeURIComponent(delegationId)}/cancel`, { method: 'POST' });
}

/** Active colleagues whose name holds every word typed (two letters at least). */
export function directorySearchQueryOptions(client: HttpClient, search: string) {
  return queryOptions({
    queryKey: [...toolsQueryKeys.directory, 'search', search] as const,
    queryFn: ({ signal }) => client.request(`/members/directory?search=${encodeURIComponent(search)}`, { schema: z.array(directoryPersonSchema), signal }),
    enabled: search.length >= 2,
  });
}

/** The names behind some ids, in one request (at most MEMBER_DIRECTORY_LIMIT; nobody behind an id is left out). */
export function directoryNamesQueryOptions(client: HttpClient, userIds: readonly string[]) {
  const ids = [...new Set(userIds)].sort().slice(0, MEMBER_DIRECTORY_LIMIT);
  return queryOptions({
    queryKey: [...toolsQueryKeys.directory, 'names', ids] as const,
    queryFn: ({ signal }) => client.request(`/members/directory?ids=${ids.join(',')}`, { schema: z.array(directoryPersonSchema), signal }),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}
