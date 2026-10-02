import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { PageQuery, PdfDesign } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PdfFormatRow {
  readonly id: string;
  readonly workflowId: string;
  readonly name: string;
  readonly description: string | null;
  readonly design: unknown;
  readonly fileNamePattern: string | null;
  readonly isActive: boolean;
  readonly updatedAt: Date;
}

export interface PdfFormatWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly design?: PdfDesign;
  readonly fileNamePattern?: string | null;
  readonly isActive?: boolean;
}

const SELECT = { id: true, workflowId: true, name: true, description: true, design: true, fileNamePattern: true, isActive: true, updatedAt: true } as const;

@Injectable()
export class PdfFormatRepository {
  async list(tx: TenantTransaction, tenantId: string, workflowId: string, query: PageQuery): Promise<{ rows: PdfFormatRow[]; total: number }> {
    const where = { tenantId, workflowId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([tx.pdfFormat.findMany({ where, select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageWindow(query) }), tx.pdfFormat.count({ where })]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<PdfFormatRow | null> {
    return tx.pdfFormat.findFirst({ where: { tenantId, workflowId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, workflowId: string, updatedById: string, data: Required<Pick<PdfFormatWrite, 'name' | 'design'>> & PdfFormatWrite): Promise<PdfFormatRow> {
    return tx.pdfFormat.create({ data: { tenantId, workflowId, updatedById, name: data.name, description: data.description ?? null, design: data.design as Prisma.InputJsonValue, fileNamePattern: data.fileNamePattern ?? null }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, workflowId: string, id: string, updatedById: string, data: PdfFormatWrite): Promise<void> {
    const { design, ...rest } = data;
    await tx.pdfFormat.updateMany({ where: { tenantId, workflowId, id }, data: { ...rest, ...(design === undefined ? {} : { design: design as Prisma.InputJsonValue }), updatedById } });
  }

  async remove(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<void> {
    await tx.pdfFormat.deleteMany({ where: { tenantId, workflowId, id } });
  }

  async isUsed(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    return (await tx.workflowDocument.count({ where: { tenantId, formatId: id } })) > 0;
  }
}
