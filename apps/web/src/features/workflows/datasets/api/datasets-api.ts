import { type CreateDatasetRequest, pageResponseSchema, type ReloadDatasetRequest, type UpdateDatasetRequest } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import type { UploadRoutes } from '@/shared/files/upload-files';

export const DATASETS_PAGE_SIZE = 25;
export const DATASET_ROWS_PAGE_SIZE = 50;

export const datasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  workflowId: z.string().nullable(),
  columns: z.array(z.object({ name: z.string(), isKey: z.boolean() })),
  keyColumn: z.string().nullable(),
  rowCount: z.number().int(),
  sourceFileName: z.string().nullable(),
  loadedAt: z.string(),
  isActive: z.boolean(),
});
export type Dataset = z.infer<typeof datasetSchema>;

const rowSchema = z.record(z.string(), z.string());

export interface DatasetListParams {
  readonly page: number;
  readonly search: string;
  readonly includeInactive: boolean;
}

/** Under `datasets`, the same root the builder's choice of a dataset uses, so a change refreshes both. */
export const datasetQueryKeys = {
  all: ['datasets'] as const,
  list: (params: DatasetListParams) => ['datasets', 'list', params] as const,
  detail: (datasetId: string) => ['datasets', 'detail', datasetId] as const,
  rows: (datasetId: string, page: number) => ['datasets', 'detail', datasetId, 'rows', page] as const,
};

const datasetUrl = (datasetId: string) => `/datasets/${encodeURIComponent(datasetId)}`;

export function datasetsQueryOptions(client: HttpClient, params: DatasetListParams) {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(DATASETS_PAGE_SIZE), includeInactive: String(params.includeInactive) });
  if (params.search !== '') query.set('search', params.search);
  return queryOptions({
    queryKey: datasetQueryKeys.list(params),
    queryFn: ({ signal }) => client.request(`/datasets?${query.toString()}`, { schema: pageResponseSchema(datasetSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

export function datasetQueryOptions(client: HttpClient, datasetId: string) {
  return queryOptions({ queryKey: datasetQueryKeys.detail(datasetId), queryFn: ({ signal }) => client.request(datasetUrl(datasetId), { schema: datasetSchema, signal }) });
}

export function datasetRowsQueryOptions(client: HttpClient, datasetId: string, page: number) {
  return queryOptions({
    queryKey: datasetQueryKeys.rows(datasetId, page),
    queryFn: ({ signal }) => client.request(`${datasetUrl(datasetId)}/rows?page=${page}&pageSize=${DATASET_ROWS_PAGE_SIZE}`, { schema: pageResponseSchema(rowSchema), signal }),
    placeholderData: keepPreviousData,
  });
}

/** A workbook is uploaded under the workflow permissions, not the ticket ones a designer may lack. */
export const DATASET_UPLOAD_ROUTES: UploadRoutes = { request: '/datasets/uploads', confirm: (fileId) => `/datasets/uploads/${encodeURIComponent(fileId)}/confirm` };

export function createDataset(client: HttpClient, body: CreateDatasetRequest) {
  return client.request('/datasets', { method: 'POST', body, schema: datasetSchema });
}

/** Every row is replaced by the upload's; without `keyColumn` the current key stays. */
export function reloadDataset(client: HttpClient, datasetId: string, body: ReloadDatasetRequest) {
  return client.request(`${datasetUrl(datasetId)}/content`, { method: 'PUT', body, schema: datasetSchema });
}

export function updateDataset(client: HttpClient, datasetId: string, body: UpdateDatasetRequest) {
  return client.request(datasetUrl(datasetId), { method: 'PATCH', body, schema: datasetSchema });
}

export function deleteDataset(client: HttpClient, datasetId: string) {
  return client.request(datasetUrl(datasetId), { method: 'DELETE' });
}
