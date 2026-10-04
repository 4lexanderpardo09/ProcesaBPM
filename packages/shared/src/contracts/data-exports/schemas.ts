import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../auth/password.js';

/**
 * Asking for a copy of the organization's data (only during the deletion period, by the owner or an administrator).
 * The current password is checked again: a stolen session alone cannot take the data out.
 */
export const requestDataExportSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  /** Without the attached files, a very large organization can still get its data. */
  includeFiles: z.boolean().default(true),
});
export type RequestDataExport = z.infer<typeof requestDataExportSchema>;

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
