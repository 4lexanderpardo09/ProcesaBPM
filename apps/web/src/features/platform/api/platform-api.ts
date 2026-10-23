import {
  type AnnouncementRequest,
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
