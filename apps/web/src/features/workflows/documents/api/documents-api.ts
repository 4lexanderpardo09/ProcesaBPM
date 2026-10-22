import {
  ACROFORM_TYPES,
  type CreatePdfFormatRequest,
  type CreateWorkflowDocumentRequest,
  DOCUMENT_MOMENTS,
  pageResponseSchema,
  anyPdfDesignSchema,
  type TemplateMapping,
  templateMappingSchema,
  type RegisterPdfTemplateRequest,
  type UpdatePdfFormatRequest,
  type UpdatePdfTemplateRequest,
  type UpdateWorkflowDocumentRequest,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { type UploadRoutes, uploadFiles } from '@/shared/files/upload-files';
import { workflowQueryKeys } from '../../api/workflows-api';

/** A workflow has a handful of each; the API's largest page holds them all. */
const ALL = 'pageSize=100&includeInactive=true';

const problemSchema = z.object({ code: z.string(), path: z.string(), detail: z.string().optional() });
export type SourceProblem = z.infer<typeof problemSchema>;

export const workflowDocumentSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  companyId: z.string().nullable(),
  kind: z.enum(['DESIGNED', 'TEMPLATE']),
  formatId: z.string().nullable(),
  templateId: z.string().nullable(),
  moment: z.enum(DOCUMENT_MOMENTS).nullable(),
  isActive: z.boolean(),
});
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type DocumentMoment = (typeof DOCUMENT_MOMENTS)[number];

export const pdfFormatSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  design: anyPdfDesignSchema,
  fileNamePattern: z.string().nullable(),
  isActive: z.boolean(),
  updatedAt: z.string(),
  warnings: z.array(problemSchema),
});
export type PdfFormat = z.infer<typeof pdfFormatSchema>;

export const pdfTemplateSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  companyId: z.string().nullable(),
  fileId: z.string(),
  name: z.string(),
  pageCount: z.number().int(),
  hasAcroform: z.boolean(),
  acroformFields: z.array(z.object({ name: z.string(), type: z.enum(ACROFORM_TYPES), page: z.number().int().nullable() })),
  isActive: z.boolean(),
  updatedAt: z.string(),
});
export type PdfTemplate = z.infer<typeof pdfTemplateSchema>;

export const documentQueryKeys = {
  all: (workflowId: string) => [...workflowQueryKeys.detail(workflowId), 'pdf'] as const,
  documents: (workflowId: string) => [...documentQueryKeys.all(workflowId), 'documents'] as const,
  formats: (workflowId: string) => [...documentQueryKeys.all(workflowId), 'formats'] as const,
  format: (workflowId: string, formatId: string) => [...documentQueryKeys.all(workflowId), 'formats', formatId] as const,
  templates: (workflowId: string) => [...documentQueryKeys.all(workflowId), 'templates'] as const,
  template: (workflowId: string, templateId: string) => [...documentQueryKeys.all(workflowId), 'templates', templateId] as const,
  mapping: (workflowId: string, templateId: string) => [...documentQueryKeys.all(workflowId), 'templates', templateId, 'mapping'] as const,
  images: (workflowId: string) => [...documentQueryKeys.all(workflowId), 'images'] as const,
};

const base = (workflowId: string) => `/workflows/${encodeURIComponent(workflowId)}`;
const item = (workflowId: string, kind: 'documents' | 'pdf-formats' | 'pdf-templates', id: string) => `${base(workflowId)}/${kind}/${encodeURIComponent(id)}`;

export function workflowDocumentsQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.documents(workflowId),
    queryFn: ({ signal }) => client.request(`${base(workflowId)}/documents?${ALL}`, { schema: pageResponseSchema(workflowDocumentSchema), signal }),
    select: (page) => page.items,
  });
}

export function pdfFormatsQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.formats(workflowId),
    queryFn: ({ signal }) => client.request(`${base(workflowId)}/pdf-formats?${ALL}`, { schema: pageResponseSchema(pdfFormatSchema), signal }),
    select: (page) => page.items,
  });
}

export function pdfFormatQueryOptions(client: HttpClient, workflowId: string, formatId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.format(workflowId, formatId),
    queryFn: ({ signal }) => client.request(item(workflowId, 'pdf-formats', formatId), { schema: pdfFormatSchema, signal }),
    // The designer holds the person's unsaved work: it is never replaced behind their back.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function pdfTemplatesQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.templates(workflowId),
    queryFn: ({ signal }) => client.request(`${base(workflowId)}/pdf-templates?${ALL}`, { schema: pageResponseSchema(pdfTemplateSchema), signal }),
    select: (page) => page.items,
  });
}

export function createWorkflowDocument(client: HttpClient, workflowId: string, body: CreateWorkflowDocumentRequest) {
  return client.request(`${base(workflowId)}/documents`, { method: 'POST', body, schema: workflowDocumentSchema });
}

export function updateWorkflowDocument(client: HttpClient, workflowId: string, documentId: string, body: UpdateWorkflowDocumentRequest) {
  return client.request(item(workflowId, 'documents', documentId), { method: 'PATCH', body, schema: workflowDocumentSchema });
}

export function deleteWorkflowDocument(client: HttpClient, workflowId: string, documentId: string) {
  return client.request(item(workflowId, 'documents', documentId), { method: 'DELETE' });
}

export function createPdfFormat(client: HttpClient, workflowId: string, body: CreatePdfFormatRequest) {
  return client.request(`${base(workflowId)}/pdf-formats`, { method: 'POST', body, schema: pdfFormatSchema });
}

export function updatePdfFormat(client: HttpClient, workflowId: string, formatId: string, body: UpdatePdfFormatRequest) {
  return client.request(item(workflowId, 'pdf-formats', formatId), { method: 'PATCH', body, schema: pdfFormatSchema });
}

export function deletePdfFormat(client: HttpClient, workflowId: string, formatId: string) {
  return client.request(item(workflowId, 'pdf-formats', formatId), { method: 'DELETE' });
}

/** The saved format drawn with sample values (or the ones given, by field code). */
export function previewPdfFormat(client: HttpClient, workflowId: string, formatId: string, values: Record<string, unknown> = {}) {
  return client.request(`${item(workflowId, 'pdf-formats', formatId)}/preview`, { method: 'POST', body: { values }, responseType: 'blob' });
}

export const pdfImageSchema = z.object({ id: z.string(), workflowId: z.string(), name: z.string(), mimeType: z.string(), sizeBytes: z.number(), createdAt: z.string(), url: z.string(), urlExpiresAt: z.string() });
export type PdfImage = z.infer<typeof pdfImageSchema>;

/** The images the workflow's canvas formats can show, each with a short-lived link to draw it in the editor. */
export function pdfImagesQueryOptions(client: HttpClient, workflowId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.images(workflowId),
    queryFn: ({ signal }) => client.request(`${base(workflowId)}/pdf-images`, { schema: z.array(pdfImageSchema), signal }),
    // The links last 15 minutes.
    staleTime: 10 * 60_000,
  });
}

const IMAGE_UPLOAD_ROUTES: UploadRoutes = { request: '/pdf-images/uploads', confirm: (fileId) => `/pdf-images/uploads/${encodeURIComponent(fileId)}/confirm` };

/** Uploads an image (PNG or JPEG) and registers it in the workflow, named after the file. */
export async function uploadPdfImage(client: HttpClient, workflowId: string, file: File): Promise<PdfImage> {
  const [stored] = await uploadFiles(client, [file], fetch, IMAGE_UPLOAD_ROUTES);
  const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 200) || file.name;
  return client.request(`${base(workflowId)}/pdf-images`, { method: 'POST', body: { fileId: stored!.id, name }, schema: pdfImageSchema });
}

export function deletePdfImage(client: HttpClient, workflowId: string, imageId: string) {
  return client.request(`${base(workflowId)}/pdf-images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
}

/** A template PDF is uploaded under the PDF permissions, not the ticket ones a designer may lack. */
export const TEMPLATE_UPLOAD_ROUTES: UploadRoutes = { request: '/pdf-templates/uploads', confirm: (fileId) => `/pdf-templates/uploads/${encodeURIComponent(fileId)}/confirm` };

export function registerPdfTemplate(client: HttpClient, workflowId: string, body: RegisterPdfTemplateRequest) {
  return client.request(`${base(workflowId)}/pdf-templates`, { method: 'POST', body, schema: pdfTemplateSchema });
}

export function updatePdfTemplate(client: HttpClient, workflowId: string, templateId: string, body: UpdatePdfTemplateRequest) {
  return client.request(item(workflowId, 'pdf-templates', templateId), { method: 'PATCH', body, schema: pdfTemplateSchema });
}

export function deletePdfTemplate(client: HttpClient, workflowId: string, templateId: string) {
  return client.request(item(workflowId, 'pdf-templates', templateId), { method: 'DELETE' });
}

export function previewPdfTemplate(client: HttpClient, workflowId: string, templateId: string, values: Record<string, unknown> = {}) {
  return client.request(`${item(workflowId, 'pdf-templates', templateId)}/preview`, { method: 'POST', body: { values }, responseType: 'blob' });
}

export function pdfTemplateQueryOptions(client: HttpClient, workflowId: string, templateId: string) {
  return queryOptions({ queryKey: documentQueryKeys.template(workflowId, templateId), queryFn: ({ signal }) => client.request(item(workflowId, 'pdf-templates', templateId), { schema: pdfTemplateSchema, signal }) });
}

const mappingResponseSchema = z.object({ mapping: templateMappingSchema, warnings: z.array(problemSchema) });
export type MappingResponse = { readonly mapping: TemplateMapping; readonly warnings: readonly SourceProblem[] };

export function templateMappingQueryOptions(client: HttpClient, workflowId: string, templateId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.mapping(workflowId, templateId),
    queryFn: ({ signal }): Promise<MappingResponse> => client.request(`${item(workflowId, 'pdf-templates', templateId)}/mapping`, { schema: mappingResponseSchema, signal }),
    // The mapper holds the person's unsaved work: it is never replaced behind their back.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function saveTemplateMapping(client: HttpClient, workflowId: string, templateId: string, mapping: TemplateMapping): Promise<MappingResponse> {
  return client.request(`${item(workflowId, 'pdf-templates', templateId)}/mapping`, { method: 'PUT', body: mapping, schema: mappingResponseSchema });
}

/** A short-lived link to the uploaded PDF itself, to draw its pages while placing the data. */
export function templateFileUrl(client: HttpClient, workflowId: string, templateId: string) {
  return client.request(`${item(workflowId, 'pdf-templates', templateId)}/file/download-url`, { schema: z.object({ url: z.string() }) });
}
