import {
  type AddCountryHolidayRequest,
  type AnnouncementRequest,
  countryHolidayResponseSchema,
  type CreateCountryRequest,
  failedOutboxEventSchema,
  type ListPlatformAuditQuery,
  platformAuditEntrySchema,
  platformMetricsSchema,
  regeneratedHolidaysSchema,
  type RequestTenantDeletion,
  tenantDeletionResponseSchema,
  type InvitePlatformAdminRequest,
  type MfaResetRequest,
  mfaResetResponseSchema,
  platformAdminSummarySchema,
  platformUserResponseSchema,
  type UpdatePlanRequest,
  countrySummarySchema,
  type CreateTenantRequest,
  createTenantResponseSchema,
  type ListTenantsQuery,
  pageResponseSchema,
  planSummarySchema,
  platformAnnouncementResponseSchema,
  tenantDetailSchema,
  tenantListItemSchema,
  tenantStatusResponseSchema,
} from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

/** Everything the console reads lives under this key, dropped when its session ends. */
export const platformQueryKeys = {
  all: ['platform'] as const,
  tenants: (query: Partial<ListTenantsQuery>) => [...platformQueryKeys.all, 'tenants', query] as const,
  tenant: (tenantId: string) => [...platformQueryKeys.all, 'tenant', tenantId] as const,
  plans: () => [...platformQueryKeys.all, 'plans'] as const,
  countries: () => [...platformQueryKeys.all, 'countries'] as const,
  announcements: () => [...platformQueryKeys.all, 'announcements'] as const,
  admins: () => [...platformQueryKeys.all, 'admins'] as const,
  holidays: (code: string, year: number) => [...platformQueryKeys.all, 'holidays', code, year] as const,
  failedEvents: (scope: string, page: number) => [...platformQueryKeys.all, 'failed-events', scope, page] as const,
  metrics: () => [...platformQueryKeys.all, 'metrics'] as const,
  audit: (filters: Partial<ListPlatformAuditQuery>) => [...platformQueryKeys.all, 'audit', filters] as const,
};

const query = (values: Readonly<Record<string, string | number | undefined>>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
};

export function tenantsQueryOptions(client: HttpClient, filters: Partial<ListTenantsQuery>) {
  return queryOptions({
    queryKey: platformQueryKeys.tenants(filters),
    queryFn: ({ signal }) => client.request(`/platform/tenants${query({ ...filters })}`, { schema: pageResponseSchema(tenantListItemSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

export function tenantQueryOptions(client: HttpClient, tenantId: string) {
  return queryOptions({
    queryKey: platformQueryKeys.tenant(tenantId),
    queryFn: ({ signal }) => client.request(`/platform/tenants/${encodeURIComponent(tenantId)}`, { schema: tenantDetailSchema, signal }),
  });
}

export function plansQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: platformQueryKeys.plans(), queryFn: ({ signal }) => client.request('/platform/plans', { schema: z.array(planSummarySchema), signal }) });
}

export function countriesQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: platformQueryKeys.countries(), queryFn: ({ signal }) => client.request('/platform/catalog/countries', { schema: z.array(countrySummarySchema), signal }) });
}

export function announcementsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: platformQueryKeys.announcements(), queryFn: ({ signal }) => client.request('/platform/announcements', { schema: z.array(platformAnnouncementResponseSchema), signal }) });
}

export function createTenant(client: HttpClient, body: CreateTenantRequest) {
  return client.request('/platform/tenants', { method: 'POST', body, schema: createTenantResponseSchema });
}

export function suspendTenant(client: HttpClient, tenantId: string, reason: string) {
  return client.request(`/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, { method: 'POST', body: { reason }, schema: tenantStatusResponseSchema });
}

export function reactivateTenant(client: HttpClient, tenantId: string, reason: string | undefined) {
  return client.request(`/platform/tenants/${encodeURIComponent(tenantId)}/reactivate`, { method: 'POST', body: reason === undefined ? {} : { reason }, schema: tenantStatusResponseSchema });
}

export function changeTenantPlan(client: HttpClient, tenantId: string, planCode: string) {
  return client.request(`/platform/tenants/${encodeURIComponent(tenantId)}/plan`, { method: 'PUT', body: { planCode }, schema: tenantDetailSchema });
}

export function saveAnnouncement(client: HttpClient, id: string | undefined, body: AnnouncementRequest) {
  return id === undefined
    ? client.request('/platform/announcements', { method: 'POST', body, schema: platformAnnouncementResponseSchema })
    : client.request(`/platform/announcements/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: platformAnnouncementResponseSchema });
}

export function deleteAnnouncement(client: HttpClient, id: string) {
  return client.request(`/platform/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function updatePlan(client: HttpClient, code: string, body: UpdatePlanRequest) {
  return client.request(`/platform/plans/${encodeURIComponent(code)}`, { method: 'PUT', body, schema: planSummarySchema });
}

export function adminsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: platformQueryKeys.admins(), queryFn: ({ signal }) => client.request('/platform/admins', { schema: z.array(platformAdminSummarySchema), signal }) });
}

export function inviteAdmin(client: HttpClient, body: InvitePlatformAdminRequest) {
  return client.request('/platform/admins', { method: 'POST', body, schema: platformAdminSummarySchema });
}

export function revokeAdmin(client: HttpClient, userId: string) {
  return client.request(`/platform/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

/** An account by its exact e-mail (support never searches): a mutation, so nothing of it stays in a cache. */
export function lookUpUser(client: HttpClient, email: string) {
  return client.request(`/platform/users${query({ email })}`, { schema: platformUserResponseSchema });
}

export function resetUserMfa(client: HttpClient, userId: string, body: MfaResetRequest) {
  return client.request(`/platform/users/${encodeURIComponent(userId)}/mfa-reset`, { method: 'POST', body, schema: mfaResetResponseSchema });
}

export function createCountry(client: HttpClient, body: CreateCountryRequest) {
  return client.request('/platform/catalog/countries', { method: 'POST', body, schema: countrySummarySchema });
}

const holidaysPath = (code: string) => `/platform/catalog/countries/${encodeURIComponent(code)}/holidays`;

export function holidaysQueryOptions(client: HttpClient, code: string, year: number) {
  return queryOptions({ queryKey: platformQueryKeys.holidays(code, year), queryFn: ({ signal }) => client.request(`${holidaysPath(code)}${query({ year })}`, { schema: z.array(countryHolidayResponseSchema), signal }) });
}

export function addHoliday(client: HttpClient, code: string, body: AddCountryHolidayRequest) {
  return client.request(holidaysPath(code), { method: 'POST', body, schema: countryHolidayResponseSchema });
}

export function removeHoliday(client: HttpClient, code: string, date: string) {
  return client.request(`${holidaysPath(code)}/${encodeURIComponent(date)}`, { method: 'DELETE' });
}

export function regenerateHolidays(client: HttpClient, code: string, year: number) {
  return client.request(`${holidaysPath(code)}/regenerate`, { method: 'POST', body: { year }, schema: regeneratedHolidaysSchema });
}

export function failedEventsQueryOptions(client: HttpClient, scope: 'PLATFORM' | 'TENANT', page: number) {
  return queryOptions({
    queryKey: platformQueryKeys.failedEvents(scope, page),
    queryFn: ({ signal }) => client.request(`/platform/operations/outbox-events/failed${query({ scope, page })}`, { schema: pageResponseSchema(failedOutboxEventSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

export function retryEvent(client: HttpClient, event: { readonly scope: 'PLATFORM' | 'TENANT'; readonly tenantId: string | null; readonly id: string }) {
  const path = event.scope === 'PLATFORM' ? `/platform/operations/outbox-events/platform/${encodeURIComponent(event.id)}/retry` : `/platform/operations/outbox-events/tenants/${encodeURIComponent(event.tenantId ?? '')}/${encodeURIComponent(event.id)}/retry`;
  return client.request(path, { method: 'POST' });
}

export function metricsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: platformQueryKeys.metrics(), queryFn: ({ signal }) => client.request('/platform/operations/metrics', { schema: platformMetricsSchema, signal }) });
}

export function auditQueryOptions(client: HttpClient, filters: Partial<ListPlatformAuditQuery>) {
  return queryOptions({
    queryKey: platformQueryKeys.audit(filters),
    queryFn: ({ signal }) => client.request(`/platform/audit-logs${query({ ...filters })}`, { schema: pageResponseSchema(platformAuditEntrySchema), signal }),
    placeholderData: keepPreviousData,
  });
}

export function requestDeletion(client: HttpClient, tenantId: string, body: RequestTenantDeletion) {
  return client.request(`/platform/tenants/${encodeURIComponent(tenantId)}/deletion`, { method: 'POST', body, schema: tenantDeletionResponseSchema });
}

export function cancelDeletion(client: HttpClient, tenantId: string) {
  return client.request(`/platform/tenants/${encodeURIComponent(tenantId)}/deletion`, { method: 'DELETE', schema: tenantDeletionResponseSchema });
}
