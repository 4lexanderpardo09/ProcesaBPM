import {
  aiAssistantSettingsResponseSchema,
  aiUsageResponseSchema,
  auditLogPageSchema,
  type EmailPolicyTypeValue,
  notificationEmailPolicyResponseSchema,
  type NotificationEmailPolicyValue,
  tenantSecuritySettingsResponseSchema,
  type TenantSecuritySettings,
  type UpdateAiAssistantSettings,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

export const settingsQueryKeys = {
  security: ['settings', 'security'] as const,
  aiAssistant: ['settings', 'ai-assistant'] as const,
  aiUsage: ['settings', 'ai-assistant', 'usage'] as const,
  emailPolicies: ['settings', 'notification-emails'] as const,
  support: ['settings', 'support-access'] as const,
  storage: ['settings', 'storage'] as const,
  calculators: ['settings', 'calculators'] as const,
  audit: (filters: AuditFilters) => ['settings', 'audit', filters] as const,
  announcements: ['announcements'] as const,
};

export function securityQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.security, queryFn: ({ signal }) => client.request('/settings/security', { schema: tenantSecuritySettingsResponseSchema, signal }) });
}

export function saveSecurity(client: HttpClient, body: TenantSecuritySettings) {
  return client.request('/settings/security', { method: 'PUT', body, schema: tenantSecuritySettingsResponseSchema });
}

export function aiAssistantQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.aiAssistant, queryFn: ({ signal }) => client.request('/settings/ai-assistant', { schema: aiAssistantSettingsResponseSchema, signal }) });
}

export function saveAiAssistant(client: HttpClient, body: UpdateAiAssistantSettings) {
  return client.request('/settings/ai-assistant', { method: 'PUT', body, schema: aiAssistantSettingsResponseSchema });
}

export function emailPoliciesQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.emailPolicies, queryFn: ({ signal }) => client.request('/settings/notification-emails', { schema: z.array(notificationEmailPolicyResponseSchema), signal }) });
}

export function saveEmailPolicy(client: HttpClient, type: EmailPolicyTypeValue, policy: NotificationEmailPolicyValue) {
  return client.request(`/settings/notification-emails/${type}`, { method: 'PUT', body: { policy }, schema: notificationEmailPolicyResponseSchema });
}

export function aiUsageQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.aiUsage, queryFn: ({ signal }) => client.request('/settings/ai-assistant/usage', { schema: aiUsageResponseSchema, signal }) });
}

const person = z.object({ userId: z.string(), name: z.string() });
const grantSchema = z.object({
  id: z.string(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
  reason: z.string(),
  grantedBy: person,
  startsAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: person.nullable(),
  visits: z.array(z.object({ id: z.string(), administrator: z.string(), openedAt: z.string(), closedAt: z.string().nullable() })),
  requests: z.number().int(),
});
export type SupportGrant = z.infer<typeof grantSchema>;
const supportSchema = z.object({ active: grantSchema.nullable(), history: z.array(grantSchema) });

export function supportAccessQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.support, queryFn: ({ signal }) => client.request('/settings/support-access', { schema: supportSchema, signal }) });
}

export function grantSupportAccess(client: HttpClient, body: { hours: number; reason: string }) {
  return client.request('/settings/support-access', { method: 'POST', body, schema: supportSchema });
}

export function revokeSupportAccess(client: HttpClient) {
  return client.request('/settings/support-access', { method: 'DELETE', schema: supportSchema });
}

/** Byte amounts come as strings: they can pass what a JSON number holds exactly. */
const storageSchema = z.object({ usedBytes: z.string(), reservedBytes: z.string(), limitBytes: z.string(), hardLimitBytes: z.string(), activeUsers: z.number().int(), state: z.enum(['OK', 'OVER_LIMIT', 'BLOCKED']) });
export type StorageUsage = z.infer<typeof storageSchema>;

export function storageQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.storage, queryFn: ({ signal }) => client.request('/storage/usage', { schema: storageSchema, signal }) });
}

export interface AuditFilters {
  /** `YYYY-MM-DD`, or empty for the API's default (the last 30 days). */
  readonly from: string;
  readonly to: string;
  /** An action, or a prefix ending in a dot (`role.`). */
  readonly action: string;
}

/** One page of the audit log, newest first; the next one starts after `cursor`. */
export function fetchAuditPage(client: HttpClient, filters: AuditFilters, cursor: string | undefined, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: '50' });
  if (filters.from !== '') query.set('from', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to !== '') query.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString());
  if (filters.action !== '') query.set('action', filters.action);
  if (cursor !== undefined) query.set('cursor', cursor);
  return client.request(`/audit-logs?${query.toString()}`, { schema: auditLogPageSchema, ...(signal === undefined ? {} : { signal }) });
}

const announcementSchema = z.object({ id: z.string(), type: z.enum(['MAINTENANCE', 'RELEASE_NOTES', 'INFO']), title: z.string(), body: z.string(), startsAt: z.string(), endsAt: z.string().nullable(), blocksLogin: z.boolean() });
export type Announcement = z.infer<typeof announcementSchema>;

export function announcementsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.announcements, queryFn: ({ signal }) => client.request('/announcements', { schema: z.array(announcementSchema), signal }), staleTime: 10 * 60_000 });
}

const calculatorSchema = z.object({
  code: z.string(),
  parameters: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() })),
  output: z.enum(['CURRENCY', 'NUMBER']),
  configured: z.boolean(),
  config: z.record(z.string(), z.unknown()).nullable(),
});

/** The built-in calculations and whether the organization switched each one on (with its configuration). */
export function calculatorsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.calculators, queryFn: ({ signal }) => client.request('/calculators', { schema: z.array(calculatorSchema), signal }) });
}

/** Switches a calculation on, or replaces its configuration; the API checks it against the calculation's own rules. */
export function configureCalculator(client: HttpClient, code: string, config: Record<string, unknown>) {
  return client.request(`/calculators/${encodeURIComponent(code)}/config`, { method: 'PUT', body: config, schema: calculatorSchema });
}

export function disableCalculator(client: HttpClient, code: string) {
  return client.request(`/calculators/${encodeURIComponent(code)}/config`, { method: 'DELETE', schema: calculatorSchema });
}
