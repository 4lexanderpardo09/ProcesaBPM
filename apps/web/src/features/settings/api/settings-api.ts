import { auditLogPageSchema, tenantSecuritySettingsResponseSchema, type TenantSecuritySettings } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

export const settingsQueryKeys = {
  security: ['settings', 'security'] as const,
  support: ['settings', 'support-access'] as const,
  storage: ['settings', 'storage'] as const,
  audit: (filters: AuditFilters) => ['settings', 'audit', filters] as const,
  announcements: ['announcements'] as const,
};

export function securityQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: settingsQueryKeys.security, queryFn: ({ signal }) => client.request('/settings/security', { schema: tenantSecuritySettingsResponseSchema, signal }) });
}

export function saveSecurity(client: HttpClient, body: TenantSecuritySettings) {
  return client.request('/settings/security', { method: 'PUT', body, schema: tenantSecuritySettingsResponseSchema });
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
