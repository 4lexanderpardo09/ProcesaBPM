import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { AcroFieldInfo, PageBox, PageQuery, TemplateMapping } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PdfTemplateRow {
  readonly id: string;
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly fileId: string;
  readonly name: string;
  readonly pages: PageBox[];
  readonly hasAcroform: boolean;
  readonly acroformFields: AcroFieldInfo[];
  readonly isActive: boolean;
  readonly updatedAt: Date;
}

export interface NewPdfTemplate {
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly fileId: string;
  readonly name: string;
  readonly pages: readonly PageBox[];
  readonly acroformFields: readonly AcroFieldInfo[];
}

const SELECT = { id: true, workflowId: true, companyId: true, fileId: true, name: true, pages: true, hasAcroform: true, acroformFields: true, isActive: true, updatedAt: true } as const;

const toRow = (row: { pages: unknown; acroformFields: unknown } & Omit<PdfTemplateRow, 'pages' | 'acroformFields'>): PdfTemplateRow => ({ ...row, pages: row.pages as PageBox[], acroformFields: row.acroformFields as AcroFieldInfo[] });

@Injectable()
export class PdfTemplateRepository {
  async list(tx: TenantTransaction, tenantId: string, workflowId: string, query: PageQuery): Promise<{ rows: PdfTemplateRow[]; total: number }> {
    const where = { tenantId, workflowId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([tx.pdfTemplate.findMany({ where, select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageWindow(query) }), tx.pdfTemplate.count({ where })]);
    return { rows: rows.map(toRow), total };
  }

  async findById(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<PdfTemplateRow | null> {
    const row = await tx.pdfTemplate.findFirst({ where: { tenantId, workflowId, id }, select: SELECT });
    return row === null ? null : toRow(row);
  }

  async create(tx: TenantTransaction, tenantId: string, template: NewPdfTemplate): Promise<PdfTemplateRow> {
    const row = await tx.pdfTemplate.create({
      data: {
        tenantId,
        workflowId: template.workflowId,
        companyId: template.companyId,
        fileId: template.fileId,
        name: template.name,
        pages: template.pages as unknown as Prisma.InputJsonValue,
        hasAcroform: template.acroformFields.length > 0,
        acroformFields: template.acroformFields as unknown as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    return toRow(row);
  }

  async update(tx: TenantTransaction, tenantId: string, workflowId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.pdfTemplate.updateMany({ where: { tenantId, workflowId, id }, data });
  }

  async remove(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<void> {
    await tx.pdfTemplate.deleteMany({ where: { tenantId, workflowId, id } });
  }

  async isUsed(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    return (await tx.workflowDocument.count({ where: { tenantId, templateId: id } })) > 0;
  }

  async storageKeyOf(tx: TenantTransaction, tenantId: string, fileId: string): Promise<string | null> {
    const file = await tx.storedFile.findFirst({ where: { tenantId, id: fileId, status: 'CONFIRMED' }, select: { storageKey: true } });
    return file?.storageKey ?? null;
  }

  async mapping(tx: TenantTransaction, tenantId: string, templateId: string): Promise<TemplateMapping> {
    const fields = await tx.pdfTemplateField.findMany({ where: { tenantId, templateId }, orderBy: { id: 'asc' } });
    const signatures = await tx.pdfTemplateSignature.findMany({ where: { tenantId, templateId }, orderBy: { id: 'asc' } });
    const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)) as Partial<T>;
    return {
      fields: fields.map(({ tenantId: _t, id: _i, templateId: _template, ...field }) => defined(field)) as TemplateMapping['fields'],
      signatures: signatures.map(({ tenantId: _t, id: _i, templateId: _template, ...signature }) => defined(signature)) as TemplateMapping['signatures'],
    };
  }

  /** Replaces the whole mapping: the editor saves the page it shows. */
  async replaceMapping(tx: TenantTransaction, tenantId: string, templateId: string, mapping: TemplateMapping): Promise<void> {
    await tx.pdfTemplateField.deleteMany({ where: { tenantId, templateId } });
    await tx.pdfTemplateSignature.deleteMany({ where: { tenantId, templateId } });
    await tx.pdfTemplateField.createMany({
      data: mapping.fields.map((field) => ({
        tenantId,
        templateId,
        mode: field.mode,
        fieldCode: field.fieldCode ?? null,
        expression: field.expression ?? null,
        acroformName: field.acroformName ?? null,
        page: field.page ?? null,
        x: field.x ?? null,
        y: field.y ?? null,
        fontSize: field.fontSize ?? null,
        maxWidth: field.maxWidth ?? null,
        align: field.align ?? null,
      })),
    });
    await tx.pdfTemplateSignature.createMany({
      data: mapping.signatures.map((signature) => ({
        tenantId,
        templateId,
        mode: signature.mode,
        stepName: signature.stepName,
        signerType: signature.signerType,
        signerLabel: signature.signerLabel ?? null,
        acroformName: signature.acroformName ?? null,
        page: signature.page ?? null,
        x: signature.x ?? null,
        y: signature.y ?? null,
        width: signature.width ?? null,
        height: signature.height ?? null,
      })),
    });
    await tx.pdfTemplate.updateMany({ where: { tenantId, id: templateId }, data: { updatedAt: new Date() } });
  }
}
