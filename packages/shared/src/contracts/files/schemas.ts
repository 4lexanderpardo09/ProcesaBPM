import { z } from 'zod';
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
  comment: z.string().trim().min(1).max(5000),
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
