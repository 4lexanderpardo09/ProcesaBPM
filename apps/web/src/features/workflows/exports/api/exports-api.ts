import {
  companyResponseSchema,
  downloadUrlResponseSchema,
  exportCatalogResponseSchema,
  exportCutoffResponseSchema,
  exportDefinitionResponseSchema,
  exportLineResponseSchema,
  exportPreviewResponseSchema,
  generateExportCutoffResponseSchema,
  pageResponseSchema,
  type SaveExportCatalogRequest,
  type SaveExportDefinitionRequest,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

const exportUrl = (id: string) => `/exports/${encodeURIComponent(id)}`;

export const exportQueryKeys = {
  all: ['exports'] as const,
  list: ['exports', 'list'] as const,
  detail: (id: string) => ['exports', 'detail', id] as const,
  cutoffs: (id: string) => ['exports', 'detail', id, 'cutoffs'] as const,
  lines: (id: string) => ['exports', 'detail', id, 'lines'] as const,
  preview: (id: string) => ['exports', 'detail', id, 'preview'] as const,
  catalogs: ['exports', 'catalogs'] as const,
  catalog: (name: string) => ['exports', 'catalogs', name] as const,
  mine: ['exports', 'mine'] as const,
};

export function exportsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: exportQueryKeys.list, queryFn: ({ signal }) => client.request('/exports', { schema: z.array(exportDefinitionResponseSchema), signal }) });
}

export function exportQueryOptions(client: HttpClient, id: string) {
  return queryOptions({ queryKey: exportQueryKeys.detail(id), queryFn: ({ signal }) => client.request(exportUrl(id), { schema: exportDefinitionResponseSchema, signal }) });
}

export function saveExport(client: HttpClient, id: string | undefined, body: SaveExportDefinitionRequest) {
  return id === undefined ? client.request('/exports', { method: 'POST', body, schema: exportDefinitionResponseSchema }) : client.request(exportUrl(id), { method: 'PUT', body, schema: exportDefinitionResponseSchema });
}

export function deleteExport(client: HttpClient, id: string) {
  return client.request(exportUrl(id), { method: 'DELETE' });
}

export function exportCutoffsQueryOptions(client: HttpClient, id: string) {
  return queryOptions({ queryKey: exportQueryKeys.cutoffs(id), queryFn: ({ signal }) => client.request(`${exportUrl(id)}/cutoffs`, { schema: z.array(exportCutoffResponseSchema), signal }) });
}

/** "Generate now": the pending lines into files at once. */
export function generateCutoff(client: HttpClient, id: string) {
  return client.request(`${exportUrl(id)}/cutoffs`, { method: 'POST', body: {}, schema: generateExportCutoffResponseSchema });
}

export function pendingLinesQueryOptions(client: HttpClient, id: string) {
  return queryOptions({ queryKey: exportQueryKeys.lines(id), queryFn: ({ signal }) => client.request(`${exportUrl(id)}/lines?pending=true`, { schema: z.array(exportLineResponseSchema), signal }) });
}

export function exportPreviewQueryOptions(client: HttpClient, id: string) {
  return queryOptions({ queryKey: exportQueryKeys.preview(id), queryFn: ({ signal }) => client.request(`${exportUrl(id)}/preview`, { schema: exportPreviewResponseSchema, signal }) });
}

/** A short-lived link to a file; `mine` asks for it as the file's responsible ("Mis planos"). */
export function cutoffDownloadUrl(client: HttpClient, cutoffId: string, mine = false) {
  return client.request(`/export-cutoffs/${mine ? 'mine/' : ''}${encodeURIComponent(cutoffId)}/download-url`, { schema: downloadUrlResponseSchema });
}

export function myCutoffsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: exportQueryKeys.mine, queryFn: ({ signal }) => client.request('/export-cutoffs/mine', { schema: z.array(exportCutoffResponseSchema), signal }) });
}

export function catalogNamesQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: exportQueryKeys.catalogs, queryFn: ({ signal }) => client.request('/export-catalogs', { schema: z.array(z.string()), signal }) });
}

export function catalogQueryOptions(client: HttpClient, name: string) {
  return queryOptions({ queryKey: exportQueryKeys.catalog(name), queryFn: ({ signal }) => client.request(`/export-catalogs/${encodeURIComponent(name)}`, { schema: exportCatalogResponseSchema, signal }) });
}

export function saveCatalog(client: HttpClient, name: string, body: SaveExportCatalogRequest) {
  return client.request(`/export-catalogs/${encodeURIComponent(name)}`, { method: 'PUT', body, schema: exportCatalogResponseSchema });
}

/** Every company, to limit an export to one. */
export function companiesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: ['exports', 'companies'] as const,
    queryFn: ({ signal }) => client.request('/companies?pageSize=100&includeInactive=true', { schema: pageResponseSchema(companyResponseSchema), signal }),
    select: (page) => page.items,
    staleTime: 5 * 60_000,
  });
}
