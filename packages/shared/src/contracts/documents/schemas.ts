import { z } from 'zod';
import { nameSchema, pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';
import { pdfDesignSchema } from '../../pdf/design-schema.js';
import { expressionSchema } from '../../pdf/design-schema.js';
import { templateMappingSchema } from '../../pdf/mapping-schema.js';

export const createPdfFormatRequestSchema = z
  .object({ name: nameSchema, description: z.string().trim().max(1000).optional(), design: pdfDesignSchema, fileNamePattern: expressionSchema.max(200).optional() })
  .strict();
export type CreatePdfFormatRequest = z.infer<typeof createPdfFormatRequestSchema>;

export const updatePdfFormatRequestSchema = z
  .object({ name: nameSchema, description: z.string().trim().max(1000).nullable(), design: pdfDesignSchema, fileNamePattern: expressionSchema.max(200).nullable(), isActive: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdatePdfFormatRequest = z.infer<typeof updatePdfFormatRequestSchema>;

/** The file must be an upload of the caller, confirmed through `POST /files/uploads` and `/files/:id/confirm`. */
export const registerPdfTemplateRequestSchema = z.object({ fileId: uuidSchema, name: nameSchema, companyId: uuidSchema.optional() }).strict();
export type RegisterPdfTemplateRequest = z.infer<typeof registerPdfTemplateRequestSchema>;

export const updatePdfTemplateRequestSchema = z
  .object({ name: nameSchema, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdatePdfTemplateRequest = z.infer<typeof updatePdfTemplateRequestSchema>;

export const putTemplateMappingRequestSchema = templateMappingSchema;

/** Sample values for a preview, by field code; anything not given is filled with a sample of its type. */
export const previewRequestSchema = z.object({ values: z.record(z.string(), z.unknown()).default({}) }).strict();
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const DOCUMENT_MOMENTS = ['CREATION', 'EACH_STEP', 'CLOSING'] as const;
export const createWorkflowDocumentRequestSchema = z
  .object({ formatId: uuidSchema.optional(), templateId: uuidSchema.optional(), companyId: uuidSchema.optional(), moment: z.enum(DOCUMENT_MOMENTS).nullable().default(null) })
  .strict()
  .refine((body) => (body.formatId === undefined) !== (body.templateId === undefined), 'Give a format or a template, not both');
export type CreateWorkflowDocumentRequest = z.infer<typeof createWorkflowDocumentRequestSchema>;

export const updateWorkflowDocumentRequestSchema = z
  .object({ moment: z.enum(DOCUMENT_MOMENTS).nullable(), isActive: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change');
export type UpdateWorkflowDocumentRequest = z.infer<typeof updateWorkflowDocumentRequestSchema>;

export const listDocumentSourcesQuerySchema = pageQuerySchema.pick({ page: true, pageSize: true, includeInactive: true });
export type ListDocumentSourcesQuery = z.infer<typeof listDocumentSourcesQuerySchema>;

export interface PdfFormatResponse {
  readonly id: string;
  readonly workflowId: string;
  readonly name: string;
  readonly description: string | null;
  readonly design: z.infer<typeof pdfDesignSchema>;
  readonly fileNamePattern: string | null;
  readonly isActive: boolean;
  readonly updatedAt: string;
  /** Problems against the workflow's draft version: they do not block saving, they block publishing. */
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly path: string; readonly detail?: string | undefined }>;
}

export interface PdfTemplateResponse {
  readonly id: string;
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly fileId: string;
  readonly name: string;
  readonly pageCount: number;
  readonly hasAcroform: boolean;
  readonly acroformFields: ReadonlyArray<{ readonly name: string; readonly type: string; readonly page: number | null }>;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

export interface TemplateMappingResponse {
  readonly mapping: z.infer<typeof templateMappingSchema>;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly path: string; readonly detail?: string | undefined }>;
}

export interface WorkflowDocumentResponse {
  readonly id: string;
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly kind: 'DESIGNED' | 'TEMPLATE';
  readonly formatId: string | null;
  readonly templateId: string | null;
  readonly moment: (typeof DOCUMENT_MOMENTS)[number] | null;
  readonly isActive: boolean;
}
