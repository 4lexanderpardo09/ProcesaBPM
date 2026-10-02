import { Injectable } from '@nestjs/common';
import type { FileStatus } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { buildStorageKey } from '../domain/storage-key.js';

export interface StoredFileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
  readonly sha256: string;
  readonly status: FileStatus;
  readonly uploadedById: string | null;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
}

export interface PendingFile {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface StaleFile {
  readonly id: string;
  readonly storageKey: string;
  readonly status: FileStatus;
  readonly sizeBytes: bigint;
}

export interface SystemFileInsert {
  readonly fileId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly companyId: string | null;
  readonly at: Date;
}

export const STORED_FILE_SELECT = {
  id: true,
  storageKey: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  status: true,
  uploadedById: true,
  createdAt: true,
  confirmedAt: true,
} as const;

interface RawRow {
  id: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: bigint;
  sha256: string;
  status: FileStatus;
  uploaded_by_id: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

const toRow = (raw: RawRow): StoredFileRow => ({
  id: raw.id,
  storageKey: raw.storage_key,
  originalName: raw.original_name,
  mimeType: raw.mime_type,
  sizeBytes: raw.size_bytes,
  sha256: raw.sha256,
  status: raw.status,
  uploadedById: raw.uploaded_by_id,
  createdAt: raw.created_at,
  confirmedAt: raw.confirmed_at,
});

/** Every query names the tenant: the row-level security policy is the second wall, not the only one. */
@Injectable()
export class StoredFileRepository {
  /** The id is generated here (not by the column default) because the storage key contains it. */
  async insertPending(tx: TenantTransaction, tenantId: string, uploaderId: string, file: PendingFile, at: Date): Promise<StoredFileRow> {
    const [generated] = await tx.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`;
    const id = generated!.id;
    return tx.storedFile.create({
      data: {
        tenantId,
        id,
        storageKey: buildStorageKey(tenantId, id, at),
        originalName: file.name,
        mimeType: file.mimeType,
        sizeBytes: BigInt(file.sizeBytes),
        sha256: file.sha256,
        origin: 'USER',
        status: 'PENDING',
        uploadedById: uploaderId,
        createdAt: at,
      },
      select: STORED_FILE_SELECT,
    });
  }

  /** A file the system produced: confirmed and linked from the start, with no uploader. The derived id makes a repeat a no-op. */
  async insertSystemFile(tx: TenantTransaction, tenantId: string, file: SystemFileInsert): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO stored_files (tenant_id, id, company_id, storage_key, original_name, mime_type, size_bytes, sha256, origin, status, uploaded_by_id, created_at, confirmed_at, linked_at)
      VALUES (${tenantId}::uuid, ${file.fileId}::uuid, ${file.companyId}::uuid, ${file.storageKey}, ${file.fileName}, ${file.mimeType}, ${BigInt(file.sizeBytes)}, ${file.sha256}, 'SYSTEM', 'CONFIRMED', NULL, ${file.at}, ${file.at}, ${file.at})
      ON CONFLICT (tenant_id, id) DO NOTHING`;
  }

  async companyOfTicket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<string | null> {
    const ticket = await tx.ticket.findFirst({ where: { tenantId, id: ticketId }, select: { companyId: true } });
    return ticket?.companyId ?? null;
  }

  countPending(tx: TenantTransaction, tenantId: string, uploaderId: string): Promise<number> {
    return tx.storedFile.count({ where: { tenantId, uploadedById: uploaderId, status: 'PENDING' } });
  }

  /** Bytes the person uploaded (reserved or confirmed) and has not attached yet. */
  async unlinkedBytes(tx: TenantTransaction, tenantId: string, uploaderId: string): Promise<bigint> {
    const { _sum } = await tx.storedFile.aggregate({ where: { tenantId, uploadedById: uploaderId, origin: 'USER', linkedAt: null, status: { in: ['PENDING', 'CONFIRMED'] } }, _sum: { sizeBytes: true } });
    return _sum.sizeBytes ?? 0n;
  }

  find(tx: TenantTransaction, tenantId: string, id: string): Promise<StoredFileRow | null> {
    return tx.storedFile.findFirst({ where: { tenantId, id }, select: STORED_FILE_SELECT });
  }

  /** The caller's own upload: someone else's file (or another tenant's) looks exactly like a missing one. */
  findOwn(tx: TenantTransaction, tenantId: string, id: string, uploaderId: string): Promise<StoredFileRow | null> {
    return tx.storedFile.findFirst({ where: { tenantId, id, uploadedById: uploaderId, origin: 'USER' }, select: STORED_FILE_SELECT });
  }

  async lock(tx: TenantTransaction, tenantId: string, id: string): Promise<StoredFileRow | null> {
    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT id::text AS id, storage_key, original_name, mime_type, size_bytes, sha256, status::text AS status, uploaded_by_id::text AS uploaded_by_id, created_at, confirmed_at
      FROM stored_files WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  async confirm(tx: TenantTransaction, tenantId: string, id: string, mimeType: string, at: Date): Promise<void> {
    await tx.storedFile.updateMany({ where: { tenantId, id, status: 'PENDING' }, data: { status: 'CONFIRMED', confirmedAt: at, mimeType } });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.storedFile.deleteMany({ where: { tenantId, id } });
  }

  /** Locks (in id order, so two submissions never wait for each other in a cycle) the uploads this person may still attach. */
  async lockAttachable(tx: TenantTransaction, tenantId: string, uploaderId: string, ids: readonly string[]): Promise<StoredFileRow[]> {
    if (ids.length === 0) return [];
    const rows = await tx.$queryRaw<RawRow[]>`
      SELECT id::text AS id, storage_key, original_name, mime_type, size_bytes, sha256, status::text AS status, uploaded_by_id::text AS uploaded_by_id, created_at, confirmed_at
      FROM stored_files
      WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${[...ids]}::uuid[]) AND uploaded_by_id = ${uploaderId}::uuid
        AND status = 'CONFIRMED' AND linked_at IS NULL AND origin = 'USER'
      ORDER BY id FOR UPDATE`;
    return rows.map(toRow);
  }

  async markLinked(tx: TenantTransaction, tenantId: string, ids: readonly string[], companyId: string | null, at: Date): Promise<number> {
    const { count } = await tx.storedFile.updateMany({ where: { tenantId, id: { in: [...ids] }, linkedAt: null }, data: { linkedAt: at, companyId } });
    return count;
  }

  /** Tenants that hold abandoned uploads: the one cross-tenant read, through a function only the worker may call. */
  async findTenantsWithStale(tx: TenantTransaction, cutoff: Date, limit: number): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ out_tenant_id: string }>>`SELECT out_tenant_id::text AS out_tenant_id FROM find_tenants_with_stale_uploads(${cutoff}, ${limit})`;
    return rows.map((row) => row.out_tenant_id);
  }

  /** Abandoned uploads: never linked, nothing else refers to them, older than the cutoff. `SKIP LOCKED` lets two workers share the work. */
  async lockStale(tx: TenantTransaction, tenantId: string, cutoff: Date, limit: number): Promise<StaleFile[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; storage_key: string; status: FileStatus; size_bytes: bigint }>>`
      SELECT f.id::text AS id, f.storage_key, f.status::text AS status, f.size_bytes
      FROM stored_files f
      WHERE f.tenant_id = ${tenantId}::uuid AND f.linked_at IS NULL AND f.status IN ('PENDING', 'CONFIRMED') AND f.origin = 'USER'
        AND f.created_at < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM step_files x WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.tenant_id = f.tenant_id AND x.signature_file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM pdf_templates x WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM export_cutoffs x WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM ticket_signatures x WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM ticket_documents x WHERE x.tenant_id = f.tenant_id AND x.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = f.tenant_id AND x.logo_file_id = f.id)
      ORDER BY f.created_at
      LIMIT ${limit}
      FOR UPDATE OF f SKIP LOCKED`;
    return rows.map((row) => ({ id: row.id, storageKey: row.storage_key, status: row.status, sizeBytes: row.size_bytes }));
  }

  async removeMany(tx: TenantTransaction, tenantId: string, ids: readonly string[]): Promise<void> {
    await tx.storedFile.deleteMany({ where: { tenantId, id: { in: [...ids] } } });
  }
}
