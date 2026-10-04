import { StorageUnavailableError } from '@procesabpm/shared';

/** Why an export attempt failed, as stored in `tenant_data_exports.error_code` (codes only: never data of the tenant). */
export type ExportFailureCode = 'EXPORT_TOO_LARGE' | 'EXPORT_TIMEOUT' | 'LEASE_LOST' | 'WORKER_STOPPED' | 'EXPORT_INCONSISTENT' | 'STORAGE_UNAVAILABLE' | 'EXPORT_FAILED';

/** `never`: retrying cannot help (the owner can ask again without files). `soon`/`later`: another attempt is worth it. */
export type ExportRetry = 'never' | 'soon' | 'later';

export abstract class ExportAttemptError extends Error {
  abstract readonly code: ExportFailureCode;
  abstract readonly retry: ExportRetry;
}

export class ExportTooLargeError extends ExportAttemptError {
  override readonly name = 'ExportTooLargeError';
  readonly code = 'EXPORT_TOO_LARGE';
  readonly retry = 'never';
}

export class ExportTimeoutError extends ExportAttemptError {
  override readonly name = 'ExportTimeoutError';
  readonly code = 'EXPORT_TIMEOUT';
  readonly retry = 'never';
}

/** The heartbeat was refused: another worker owns the export, or the purge is due. Nothing more may be written. */
export class ExportLeaseLostError extends ExportAttemptError {
  override readonly name = 'ExportLeaseLostError';
  readonly code = 'LEASE_LOST';
  readonly retry = 'later';
}

export class ExportStoppedError extends ExportAttemptError {
  override readonly name = 'ExportStoppedError';
  readonly code = 'WORKER_STOPPED';
  readonly retry = 'soon';
}

/** A dataset or the file list changed while the archive was written: it would not match its manifest. */
export class ExportInconsistentError extends ExportAttemptError {
  override readonly name = 'ExportInconsistentError';
  readonly code = 'EXPORT_INCONSISTENT';
  readonly retry = 'later';
}

export interface ExportFailure {
  readonly code: ExportFailureCode;
  readonly retry: ExportRetry;
}

/** Any error as a stored code: the known ones by type, storage outages, anything else as a generic failure. */
export function exportFailureOf(error: unknown): ExportFailure {
  if (error instanceof ExportAttemptError) return { code: error.code, retry: error.retry };
  if (error instanceof StorageUnavailableError) return { code: 'STORAGE_UNAVAILABLE', retry: 'later' };
  return { code: 'EXPORT_FAILED', retry: 'later' };
}
