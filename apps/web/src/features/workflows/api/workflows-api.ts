import { type AddObserverRequest, categoryResponseSchema, companyResponseSchema, type CreateCutoffRequest, type UpdateCutoffRequest, type CreateVersionRequest, pageResponseSchema, subcategoryResponseSchema, versionStatusSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

export const WORKFLOWS_PAGE_SIZE = 25;

const versionRefSchema = z.object({ id: z.string(), number: z.number().int() });

const workflowSchema = z.object({ id: z.string(), subcategoryId: z.string(), name: z.string(), isActive: z.boolean(), createdAt: z.string() });

export const workflowListItemSchema = workflowSchema.extend({
  subcategory: z.object({ id: z.string(), name: z.string(), category: z.object({ id: z.string(), name: z.string() }) }),
  publishedVersion: versionRefSchema.nullable(),
  draftVersion: versionRefSchema.nullable(),
});
export type WorkflowListItem = z.infer<typeof workflowListItemSchema>;

export const versionSummarySchema = z.object({
  id: z.string(),
  number: z.number().int(),
  status: versionStatusSchema,
  notes: z.string().nullable(),
  revision: z.number().int(),
  publishedAt: z.string().nullable(),
  publishedById: z.string().nullable(),
  createdAt: z.string(),
});
export type VersionSummary = z.infer<typeof versionSummarySchema>;

export const workflowDetailSchema = workflowSchema.extend({ versions: z.array(versionSummarySchema) });
export type WorkflowDetail = z.infer<typeof workflowDetailSchema>;

const observerSchema = z.object({
  id: z.string(),
  participantType: z.enum(['USER', 'POSITION', 'GROUP']),
  userId: z.string().nullable(),
  positionId: z.string().nullable(),
  groupId: z.string().nullable(),
});
export type Observer = z.infer<typeof observerSchema>;

export interface WorkflowListParams {
  readonly page: number;
  readonly search: string;
  readonly includeInactive: boolean;
}

export const workflowQueryKeys = {
  all: ['workflows'] as const,
  list: (params: WorkflowListParams) => ['workflows', 'list', params] as const,
  /** Every workflow, to know which subcategories already have one. */
  everything: ['workflows', 'everything'] as const,
  detail: (workflowId: string) => ['workflows', 'detail', workflowId] as const,
  observers: (workflowId: string) => ['workflows', 'detail', workflowId, 'observers'] as const,
  cutoffs: (workflowId: string) => ['workflows', 'detail', workflowId, 'cutoffs'] as const,
};

const workflowUrl = (workflowId: string) => `/workflows/${encodeURIComponent(workflowId)}`;

export function workflowsQueryOptions(client: HttpClient, params: WorkflowListParams) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(WORKFLOWS_PAGE_SIZE), includeInactive: String(params.includeInactive) });
  if (params.search !== '') query.set('search', params.search);
  return queryOptions({
    queryKey: workflowQueryKeys.list(params),
    queryFn: ({ signal }) => client.request(`/workflows?${query.toString()}`, { schema: pageResponseSchema(workflowListItemSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

/** The API's largest page; an organization has fewer subcategories with a workflow than this. */
export function allWorkflowsQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: workflowQueryKeys.everything,
    queryFn: ({ signal }) => client.request('/workflows?pageSize=100&includeInactive=true', { schema: pageResponseSchema(workflowListItemSchema), signal }),
    select: (page) => page.items,
  });
}

export function workflowQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({ queryKey: workflowQueryKeys.detail(workflowId), queryFn: ({ signal }) => client.request(workflowUrl(workflowId), { schema: workflowDetailSchema, signal }) });
}

/** A new workflow is born with a draft that goes from the start straight to the end. */
export function createWorkflow(client: HttpClient, body: { subcategoryId: string; name: string }) {
  return client.request('/workflows', { method: 'POST', body, schema: workflowDetailSchema });
}

export function updateWorkflow(client: HttpClient, workflowId: string, body: { name?: string; isActive?: boolean }) {
  return client.request(workflowUrl(workflowId), { method: 'PATCH', body, schema: workflowDetailSchema });
}

/** A new draft: a copy of `fromVersionId`, or empty without it. */
export function createVersion(client: HttpClient, workflowId: string, body: CreateVersionRequest) {
  return client.request(`${workflowUrl(workflowId)}/versions`, { method: 'POST', body, schema: versionSummarySchema });
}

export function deleteDraft(client: HttpClient, workflowId: string, versionId: string) {
  return client.request(`${workflowUrl(workflowId)}/versions/${encodeURIComponent(versionId)}`, { method: 'DELETE' });
}

export function observersQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({ queryKey: workflowQueryKeys.observers(workflowId), queryFn: ({ signal }) => client.request(`${workflowUrl(workflowId)}/observers`, { schema: z.array(observerSchema), signal }) });
}

export function addObserver(client: HttpClient, workflowId: string, body: AddObserverRequest) {
  return client.request(`${workflowUrl(workflowId)}/observers`, { method: 'POST', body, schema: observerSchema });
}

export function removeObserver(client: HttpClient, workflowId: string, observerId: string) {
  return client.request(`${workflowUrl(workflowId)}/observers/${encodeURIComponent(observerId)}`, { method: 'DELETE' });
}

export interface SubcategoryChoice {
  readonly id: string;
  readonly name: string;
  readonly categoryName: string;
}

/** Active subcategories with their category, by category and then by name, for "Nuevo flujo". */
export function subcategoryChoicesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['workflows', 'subcategory-choices'] as const,
    queryFn: async ({ signal }): Promise<SubcategoryChoice[]> => {
      const [categories, subcategories] = await Promise.all([
        client.request('/categories?pageSize=100', { schema: pageResponseSchema(categoryResponseSchema), signal }),
        client.request('/subcategories?pageSize=100', { schema: pageResponseSchema(subcategoryResponseSchema), signal }),
      ]);
      const categoryName = new Map(categories.items.map((category) => [category.id, category.name]));
      return subcategories.items
        .filter((subcategory) => categoryName.has(subcategory.categoryId))
        .map((subcategory) => ({ id: subcategory.id, name: subcategory.name, categoryName: categoryName.get(subcategory.categoryId) ?? '' }))
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'es') || a.name.localeCompare(b.name, 'es'));
    },
  });
}

const cutoffSchema = z.object({ id: z.string(), companyId: z.string(), cutoffDay: z.number().int(), graceBusinessDays: z.number().int(), description: z.string().nullable(), isActive: z.boolean() });
export type Cutoff = z.infer<typeof cutoffSchema>;

/** The monthly cutoff days of each company for this workflow (CUTOFF deadlines and waits read them). */
export function cutoffsQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({ queryKey: workflowQueryKeys.cutoffs(workflowId), queryFn: ({ signal }) => client.request(`${workflowUrl(workflowId)}/cutoffs`, { schema: z.array(cutoffSchema), signal }) });
}

export function createCutoff(client: HttpClient, workflowId: string, body: CreateCutoffRequest) {
  return client.request(`${workflowUrl(workflowId)}/cutoffs`, { method: 'POST', body, schema: cutoffSchema });
}

/** The API takes a partial change here (`PATCH`), the one exception to `PUT` in the workflows screens. */
export function updateCutoff(client: HttpClient, workflowId: string, cutoffId: string, body: UpdateCutoffRequest) {
  return client.request(`${workflowUrl(workflowId)}/cutoffs/${encodeURIComponent(cutoffId)}`, { method: 'PATCH', body, schema: cutoffSchema });
}

export function removeCutoff(client: HttpClient, workflowId: string, cutoffId: string) {
  return client.request(`${workflowUrl(workflowId)}/cutoffs/${encodeURIComponent(cutoffId)}`, { method: 'DELETE' });
}

/** Every company of the organization, for naming the cutoffs and choosing one. */
export function companiesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['workflows', 'companies'] as const,
    queryFn: ({ signal }) => client.request('/companies?pageSize=100&includeInactive=true', { schema: pageResponseSchema(companyResponseSchema), signal }),
    select: (page) => page.items,
    staleTime: 5 * 60_000,
  });
}
