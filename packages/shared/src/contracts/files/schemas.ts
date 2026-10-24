import { z } from 'zod';
import { RICH_TEXT_MAX } from '../common.js';
import { allowedTypeOf, MAX_FILE_BYTES, MAX_FILES_PER_SUBMISSION, MAX_SUBMISSION_BYTES } from '../../files/file-types.js';
import { uuidSchema } from '../ids.js';

// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARACTERS = /[/\\\u0000-\u001f\u007f]/;

const declaredFileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) => !FORBIDDEN_NAME_CHARACTERS.test(name), 'The name has forbidden characters')
    .refine((name) => allowedTypeOf(name) !== undefined, 'The file type is not allowed'),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_BYTES),
  /** Computed by the browser (WebCrypto); the server compares it with the uploaded content. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** The type is decided by the extension (browsers' MIME types are unreliable) and checked against the content later. */
export const requestUploadsSchema = z.object({
  files: z
    .array(declaredFileSchema)
    .min(1)
    .max(MAX_FILES_PER_SUBMISSION)
    .refine((files) => files.reduce((total, file) => total + file.sizeBytes, 0) <= MAX_SUBMISSION_BYTES, 'The files add up to more than the submission limit'),
});
export type RequestUploadsRequest = z.infer<typeof requestUploadsSchema>;

/** Ids of confirmed uploads to attach to the record being created, advanced, closed or commented. */
export const attachmentIdsSchema = z
  .array(uuidSchema.transform((id) => id.toLowerCase()))
  .max(MAX_FILES_PER_SUBMISSION)
  .refine((ids) => new Set(ids).size === ids.length, 'Repeated attachments')
  .default([]);

export const commentTicketRequestSchema = z.object({
  comment: z.string().trim().min(1).max(RICH_TEXT_MAX),
  attachments: attachmentIdsSchema,
});
export type CommentTicketRequest = z.infer<typeof commentTicketRequestSchema>;

export interface CommentTicketResponse {
  readonly eventId: string;
}

export interface UploadSlotResponse {
  readonly fileId: string;
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface UploadsResponse {
  readonly uploads: readonly UploadSlotResponse[];
  /** True when this upload takes the tenant above its plan's limit (still inside the grace margin). */
  readonly quota: { readonly overLimit: boolean };
}

export interface StoredFileResponse {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: 'PENDING' | 'CONFIRMED' | 'DELETED';
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export interface TicketDocumentResponse {
  readonly id: string;
  readonly role: string;
  readonly eventId: string | null;
  readonly stepId: string | null;
  readonly fieldCode: string | null;
  readonly version: number;
  readonly isCurrent: boolean;
  readonly createdAt: string;
  readonly file: StoredFileResponse;
}

export interface DownloadUrlResponse {
  readonly url: string;
  readonly expiresAt: string;
}

/** Parse schemas of the responses above (for the web client); `satisfies` keeps them in step with the interfaces. */
/** Parses `UploadsResponse` (for the web client). */
export const uploadsResponseSchema = z.object({
  uploads: z.array(z.object({ fileId: uuidSchema, url: z.string(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: z.string() })),
  quota: z.object({ overLimit: z.boolean() }),
}) satisfies z.ZodType<UploadsResponse>;

export const commentTicketResponseSchema = z.object({ eventId: uuidSchema }) satisfies z.ZodType<CommentTicketResponse>;

export const storedFileResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(['PENDING', 'CONFIRMED', 'DELETED']),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
}) satisfies z.ZodType<StoredFileResponse>;

export const ticketDocumentResponseSchema = z.object({
  id: uuidSchema,
  role: z.string(),
  eventId: uuidSchema.nullable(),
  stepId: uuidSchema.nullable(),
  fieldCode: z.string().nullable(),
  version: z.number(),
  isCurrent: z.boolean(),
  createdAt: z.string(),
  file: storedFileResponseSchema,
}) satisfies z.ZodType<TicketDocumentResponse>;

export const downloadUrlResponseSchema = z.object({ url: z.string(), expiresAt: z.string() }) satisfies z.ZodType<DownloadUrlResponse>;

/** `GET /tickets/:id/step-files`: the support files the workflow attaches to the ticket's current step (a guide, a format to fill). */
export interface TicketStepFileResponse {
  readonly label: string;
  readonly file: StoredFileResponse;
}

export const ticketStepFileResponseSchema = z.object({ label: z.string(), file: storedFileResponseSchema }) satisfies z.ZodType<TicketStepFileResponse>;
export const ticketStepFilesResponseSchema = z.array(ticketStepFileResponseSchema);

/** Where the drawing of a workflow document for the ticket stands: being drawn, failed, or nothing pending (`null`). */
export type TicketDocumentJobState = 'GENERATING' | 'FAILED';

/** `GET /tickets/:id/document-jobs`: the documents the ticket's workflow draws for it, and whether one is being drawn or failed. */
export interface TicketDocumentJobsResponse {
  /** Whether the caller may ask for a document again (`POST /tickets/:id/document-jobs`). */
  readonly canRegenerate: boolean;
  readonly documents: ReadonlyArray<{
    readonly workflowDocumentId: string;
    readonly name: string;
    readonly state: TicketDocumentJobState | null;
    /** When the last request to draw it was queued; `null` when none is on record. */
    readonly requestedAt: string | null;
  }>;
}

export const ticketDocumentJobsResponseSchema = z.object({
  canRegenerate: z.boolean(),
  documents: z.array(z.object({ workflowDocumentId: uuidSchema, name: z.string(), state: z.enum(['GENERATING', 'FAILED']).nullable(), requestedAt: z.string().nullable() })),
}) satisfies z.ZodType<TicketDocumentJobsResponse>;

/** `POST /tickets/:id/document-jobs`: draw this document of the ticket again, with its current data. */
export const regenerateTicketDocumentRequestSchema = z.object({ workflowDocumentId: uuidSchema }).strict();
export type RegenerateTicketDocumentRequest = z.infer<typeof regenerateTicketDocumentRequestSchema>;

export type StorageState = 'OK' | 'OVER_LIMIT' | 'BLOCKED';

/** Byte amounts are strings: they can exceed what a JSON number holds exactly. */
export interface StorageUsageResponse {
  readonly usedBytes: string;
  readonly reservedBytes: string;
  readonly limitBytes: string;
  readonly hardLimitBytes: string;
  readonly activeUsers: number;
  readonly state: StorageState;
}
