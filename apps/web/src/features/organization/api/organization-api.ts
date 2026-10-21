import { calendarResponseSchema, companyResponseSchema, countryResponseSchema, pageResponseSchema, siteLevelResponseSchema, type SiteTreeNode, siteResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { adminQueryKeys } from '@/shared/admin/admin-api';

const ALL = 100;

/** The organization's calendars, to pick a company's (one page: an organization has a few). */
export function calendarsQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, 'calendars', 'all'] as const,
    queryFn: ({ signal }) => client.request(`/calendars?pageSize=${ALL}`, { schema: pageResponseSchema(calendarResponseSchema), signal }),
    select: (page) => page.items,
  });
}

/** The countries a company can be of (the platform's list): only these are accepted. */
export function countriesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['countries'] as const,
    queryFn: ({ signal }) => client.request('/countries', { schema: z.array(countryResponseSchema), signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The default company is the one a member without companies, and new data, fall back to. */
export function makeCompanyDefault(client: HttpClient, companyId: string) {
  return client.request(`/companies/${encodeURIComponent(companyId)}/make-default`, { method: 'POST', schema: companyResponseSchema });
}

const siteTreeNodeSchema: z.ZodType<SiteTreeNode> = z.lazy(() => siteResponseSchema.extend({ children: z.array(siteTreeNodeSchema) }));

/** Every site as a tree (roots first, then their children); the deactivated ones on request. */
export function siteTreeQueryOptions(client: HttpClient, includeInactive: boolean) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/sites', 'tree', includeInactive] as const,
    queryFn: ({ signal }) => client.request(`/sites/tree?includeInactive=${String(includeInactive)}`, { schema: z.array(siteTreeNodeSchema), signal }),
  });
}

/** The names the organization gives each level of the tree ("Regional", "Sede"…). */
export function siteLevelsQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, '/site-levels'] as const,
    queryFn: ({ signal }) => client.request('/site-levels', { schema: z.array(siteLevelResponseSchema), signal }),
  });
}

export function saveSiteLevel(client: HttpClient, level: number, name: string) {
  return client.request(`/site-levels/${level}`, { method: 'PUT', body: { name }, schema: siteLevelResponseSchema });
}

export function moveSite(client: HttpClient, siteId: string, parentId: string | null) {
  return client.request(`/sites/${encodeURIComponent(siteId)}/move`, { method: 'POST', body: { parentId }, schema: siteResponseSchema });
}
