import { Injectable } from '@nestjs/common';
import type { DataExportResponse, DataExportStatus } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** Enough for the whole deletion period (5 requests) and for a later policy that allows more. */
const LIST_SIZE = 50;

const EXPORT_SELECT = {
  id: true,
  status: true,
  includeFiles: true,
  requestedById: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  sizeBytes: true,
  sha256: true,
  counts: true,
  errorCode: true,
  downloadCount: true,
  lastDownloadedAt: true,
} as const;

interface ExportRow {
  readonly id: string;
  readonly status: DataExportStatus;
  readonly includeFiles: boolean;
  readonly requestedById: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly sizeBytes: bigint | null;
  readonly sha256: string | null;
  readonly counts: unknown;
  readonly errorCode: string | null;
  readonly downloadCount: number;
  readonly lastDownloadedAt: Date | null;
}

export interface TenantDeadline {
  readonly status: string;
  readonly purgeAfter: Date | null;
}

export interface DownloadableExport {
  readonly storageKey: string;
  readonly expiresAt: Date;
  readonly completedAt: Date;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/** The archive keeps whole numbers per dataset; anything else in the column is ignored rather than trusted. */
function countsOf(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function toResponse(row: ExportRow): DataExportResponse {
  return {
    id: row.id,
    status: row.status,
    includeFiles: row.includeFiles,
    requestedById: row.requestedById,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    expiresAt: iso(row.expiresAt),
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    sha256: row.sha256,
    counts: countsOf(row.counts),
    errorCode: row.errorCode,
    downloadCount: row.downloadCount,
    lastDownloadedAt: iso(row.lastDownloadedAt),
  };
}

/**
 * The organization's export requests, read and written in its own transaction (RLS) and always filtered by the tenant
 * too. The API inserts PENDING rows and counts downloads; the database refuses anything else (docs/base-de-datos.md §8.31).
 */
@Injectable()
export class DataExportRepository {
  async findTenantDeadline(tx: TenantTransaction, tenantId: string): Promise<TenantDeadline | undefined> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, purgeAfter: true } });
    return tenant ?? undefined;
  }

  async findSlug(tx: TenantTransaction, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
    return tenant.slug;
  }

  async countRequests(tx: TenantTransaction, tenantId: string): Promise<{ readonly requests: number; readonly inFlight: number }> {
    const requests = await tx.tenantDataExport.count({ where: { tenantId } });
    const inFlight = await tx.tenantDataExport.count({ where: { tenantId, status: { in: ['PENDING', 'RUNNING'] } } });
    return { requests, inFlight };
  }

  async create(tx: TenantTransaction, request: { readonly tenantId: string; readonly requestedById: string; readonly includeFiles: boolean }): Promise<DataExportResponse> {
    return toResponse(await tx.tenantDataExport.create({ data: request, select: EXPORT_SELECT }));
  }

  async list(tx: TenantTransaction, tenantId: string): Promise<DataExportResponse[]> {
    const rows = await tx.tenantDataExport.findMany({ where: { tenantId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LIST_SIZE, select: EXPORT_SELECT });
    return rows.map(toResponse);
  }

  async find(tx: TenantTransaction, tenantId: string, id: string): Promise<DataExportResponse | undefined> {
    const row = await tx.tenantDataExport.findUnique({ where: { tenantId_id: { tenantId, id } }, select: EXPORT_SELECT });
    return row === null ? undefined : toResponse(row);
  }

  /** A READY export that has not expired by the database clock (the clock the expiry and the trigger use). */
  async findDownloadable(tx: TenantTransaction, tenantId: string, id: string): Promise<DownloadableExport | undefined> {
    const [row] = await tx.$queryRaw<Array<{ storage_key: string; expires_at: Date; completed_at: Date }>>`
      SELECT storage_key, expires_at, completed_at FROM tenant_data_exports
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND status = 'READY' AND expires_at > now()`;
    return row === undefined ? undefined : { storageKey: row.storage_key, expiresAt: row.expires_at, completedAt: row.completed_at };
  }

  /** Counts one download of a READY export that has not expired, in one statement. `undefined`: it is no longer downloadable. */
  async countDownload(tx: TenantTransaction, tenantId: string, id: string): Promise<number | undefined> {
    const [row] = await tx.$queryRaw<Array<{ download_count: number }>>`
      UPDATE tenant_data_exports SET download_count = download_count + 1, last_downloaded_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND status = 'READY' AND expires_at > now()
      RETURNING download_count`;
    return row?.download_count;
  }
}
