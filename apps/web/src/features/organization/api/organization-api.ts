import {
  calendarResponseSchema,
  companyResponseSchema,
  countryResponseSchema,
  holidayResponseSchema,
  importHolidaysResponseSchema,
  pageResponseSchema,
  type PreviewDueDateRequest,
  previewDueDateResponseSchema,
  siteLevelResponseSchema,
  type SiteTreeNode,
  siteResponseSchema,
  workingHoursResponseSchema,
} from '@procesabpm/shared';
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

const calendarDetailSchema = calendarResponseSchema.extend({ workingHours: z.array(workingHoursResponseSchema) });

/** A calendar with its working hours (each slot of each weekday). */
export function calendarDetailQueryOptions(client: HttpClient, calendarId: string) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, 'calendars', calendarId] as const,
    queryFn: ({ signal }) => client.request(`/calendars/${encodeURIComponent(calendarId)}`, { schema: calendarDetailSchema, signal }),
  });
}

/** The holidays of a calendar in one year, by date. */
export function holidaysQueryOptions(client: HttpClient, calendarId: string, year: number) {
  return queryOptions({
    queryKey: [...adminQueryKeys.all, 'calendars', calendarId, 'holidays', year] as const,
    queryFn: ({ signal }) => client.request(`/calendars/${encodeURIComponent(calendarId)}/holidays?year=${String(year)}`, { schema: z.array(holidayResponseSchema), signal }),
  });
}

/** Replaces every slot of one weekday (0 = Sunday … 6 = Saturday); no slots makes it a non-working day. */
export function replaceWorkingDay(client: HttpClient, calendarId: string, weekday: number, slots: readonly { startTime: string; endTime: string }[]) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}/working-hours/${String(weekday)}`, { method: 'PUT', body: { slots }, schema: calendarDetailSchema });
}

export function addHoliday(client: HttpClient, calendarId: string, holiday: { date: string; name: string }) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}/holidays`, { method: 'POST', body: holiday, schema: holidayResponseSchema });
}

export function removeHoliday(client: HttpClient, calendarId: string, date: string) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}/holidays/${encodeURIComponent(date)}`, { method: 'DELETE' });
}

/** Copies the holidays of the calendar's country for that year; the days it already had are kept. */
export function importHolidays(client: HttpClient, calendarId: string, year: number) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}/holidays/import`, { method: 'POST', body: { year }, schema: importHolidaysResponseSchema });
}

/** The default calendar and one a company uses cannot go (the API refuses them). */
export function deleteCalendar(client: HttpClient, calendarId: string) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}`, { method: 'DELETE' });
}

/** When a deadline counted on the calendar would fall, as an SLA counts it. */
export function previewDueDate(client: HttpClient, calendarId: string, request: PreviewDueDateRequest) {
  return client.request(`/calendars/${encodeURIComponent(calendarId)}/preview`, { method: 'POST', body: request, schema: previewDueDateResponseSchema });
}
