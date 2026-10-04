import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { ExportDatasetName } from '../domain/export-datasets.js';
import type { ExportOrganization } from '../domain/export-manifest.js';
import { DATASET_READERS, type KeyValue } from './dataset-readers/index.js';

export type ExportRow = Readonly<Record<string, unknown>>;

/** A stored file the export copies, with the first ticket document that links it (for files/index.csv). */
export interface ExportFileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
  readonly sha256: string | null;
  readonly origin: string;
  readonly createdAt: Date;
  readonly ticketId: string | null;
  readonly fieldCode: string | null;
  readonly documentRole: string | null;
}

/** Every row of a dataset is under this many: the count wraps the page query with no practical limit. */
const ALL_ROWS = 2_147_483_647;

/**
 * Reads the tenant's data for its export, always in that tenant's transaction (RLS) and with `tenant_id` filtered in
 * every query. Only the allow-listed readers run (docs/arquitectura.md §20).
 */
@Injectable()
export class ExportDataRepository {
  async organization(tx: TenantTransaction, tenantId: string): Promise<ExportOrganization> {
    const [row] = await tx.$queryRaw<ExportOrganization[]>`SELECT id::text AS id, name, slug FROM tenants WHERE id = ${tenantId}::uuid`;
    if (row === undefined) throw new Error('The organization of the export is not readable');
    return row;
  }

  page(tx: TenantTransaction, tenantId: string, dataset: ExportDatasetName, after: readonly KeyValue[] | null, limit: number): Promise<ExportRow[]> {
    const reader = DATASET_READERS[dataset];
    return tx.$queryRaw<ExportRow[]>(reader.page(tenantId, after ?? reader.start, limit));
  }

  /** The rows the pages of `dataset` will return, counted by the same query. */
  async count(tx: TenantTransaction, tenantId: string, dataset: ExportDatasetName): Promise<number> {
    const reader = DATASET_READERS[dataset];
    const [row] = await tx.$queryRaw<Array<{ rows: number }>>(Prisma.sql`SELECT count(*)::int AS rows FROM (${reader.page(tenantId, reader.start, ALL_ROWS)}) AS dataset`);
    return row?.rows ?? 0;
  }

  /** CONFIRMED files of the tenant after `afterId`, by id. */
  filePage(tx: TenantTransaction, tenantId: string, afterId: string, limit: number): Promise<ExportFileRow[]> {
    return tx.$queryRaw<ExportFileRow[]>`
      SELECT f.id::text AS "id", f.storage_key AS "storageKey", f.original_name AS "originalName", f.mime_type AS "mimeType",
             f.size_bytes AS "sizeBytes", f.sha256 AS "sha256", f.origin::text AS "origin", f.created_at AS "createdAt",
             d.ticket_id::text AS "ticketId", d.field_code AS "fieldCode", d.role::text AS "documentRole"
      FROM stored_files f
      LEFT JOIN LATERAL (
        SELECT x.ticket_id, x.field_code, x.role FROM ticket_documents x
        WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id
        ORDER BY x.created_at, x.id LIMIT 1
      ) d ON true
      WHERE f.tenant_id = ${tenantId}::uuid AND f.status = 'CONFIRMED' AND f.id > ${afterId}::uuid
      ORDER BY f.id LIMIT ${limit}`;
  }
}
