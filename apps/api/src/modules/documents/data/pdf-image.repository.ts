import { Injectable } from '@nestjs/common';
import { PDF_IMAGE_MIME_TYPES } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PdfImageRow {
  readonly id: string;
  readonly workflowId: string;
  readonly fileId: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
}

const SELECT = { id: true, workflowId: true, fileId: true, name: true, createdAt: true, file: { select: { storageKey: true, mimeType: true, sizeBytes: true } } } as const;

type Selected = { id: string; workflowId: string; fileId: string; name: string; createdAt: Date; file: { storageKey: string; mimeType: string; sizeBytes: bigint } };

const toRow = ({ file, ...row }: Selected): PdfImageRow => ({ ...row, ...file });

@Injectable()
export class PdfImageRepository {
  async list(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<PdfImageRow[]> {
    const rows = await tx.pdfImage.findMany({ where: { tenantId, workflowId }, select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toRow);
  }

  async count(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<number> {
    return tx.pdfImage.count({ where: { tenantId, workflowId } });
  }

  async findById(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<PdfImageRow | null> {
    const row = await tx.pdfImage.findFirst({ where: { tenantId, workflowId, id }, select: SELECT });
    return row === null ? null : toRow(row);
  }

  async isRegistered(tx: TenantTransaction, tenantId: string, fileId: string): Promise<boolean> {
    return (await tx.pdfImage.count({ where: { tenantId, fileId } })) > 0;
  }

  async create(tx: TenantTransaction, tenantId: string, image: { workflowId: string; fileId: string; name: string }): Promise<PdfImageRow> {
    return toRow(await tx.pdfImage.create({ data: { tenantId, ...image }, select: SELECT }));
  }

  async remove(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<void> {
    await tx.pdfImage.deleteMany({ where: { tenantId, workflowId, id } });
  }

  async ids(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<Set<string>> {
    const rows = await tx.pdfImage.findMany({ where: { tenantId, workflowId }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  /** Storage keys of the workflow's images that can be drawn (confirmed PNG or JPEG), by image id; another workflow's id finds nothing. */
  async storageKeys(tx: TenantTransaction, tenantId: string, workflowId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.pdfImage.findMany({
      where: { tenantId, workflowId, id: { in: [...ids] }, file: { status: 'CONFIRMED', mimeType: { in: [...PDF_IMAGE_MIME_TYPES] } } },
      select: { id: true, file: { select: { storageKey: true } } },
    });
    return new Map(rows.map((row) => [row.id, row.file.storageKey]));
  }

  /** Names of the workflow's formats whose canvas shows the image. */
  async formatsShowing(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM pdf_formats
      WHERE tenant_id = ${tenantId}::uuid AND workflow_id = ${workflowId}::uuid
        AND jsonb_path_exists(design, '$.elements[*] ? (@.imageId == $id)', jsonb_build_object('id', ${id}::text))
      ORDER BY name`;
    return rows.map((row) => row.name);
  }
}
