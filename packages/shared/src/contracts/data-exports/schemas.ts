import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../auth/password.js';

const currentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/**
 * Asking for a copy of the organization's data (only during the deletion period, by the owner or an administrator).
 * The current password is checked again, here and for every download link: a stolen access token or refresh cookie
 * alone can neither start an export nor take the archive out (it can still read the list and status of the exports).
 */
export const requestDataExportSchema = z.object({
  currentPassword: currentPasswordSchema,
  /** Without the attached files, a very large organization can still get its data. */
  includeFiles: z.boolean().default(true),
});
export type RequestDataExport = z.infer<typeof requestDataExportSchema>;

/** A download link of a built export: the current password again (see `requestDataExportSchema`). */
export const issueDataExportDownloadSchema = z.object({ currentPassword: currentPasswordSchema });
export type IssueDataExportDownload = z.infer<typeof issueDataExportDownloadSchema>;

export const DATA_EXPORT_STATUSES = ['PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export interface DataExportResponse {
  readonly id: string;
  readonly status: DataExportStatus;
  readonly includeFiles: boolean;
  readonly requestedById: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Until when it can be downloaded (7 days, never after the deletion). */
  readonly expiresAt: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  /** Rows per dataset in the archive. */
  readonly counts: Readonly<Record<string, number>> | null;
  /** Why it failed, as a code (e.g. `EXPORT_TOO_LARGE`: ask again without files). */
  readonly errorCode: string | null;
  readonly downloadCount: number;
  readonly lastDownloadedAt: string | null;
}

export interface DataExportListResponse {
  /** Newest first. */
  readonly items: readonly DataExportResponse[];
}
