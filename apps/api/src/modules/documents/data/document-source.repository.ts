import { Injectable } from '@nestjs/common';
import type { AcroFieldInfo, PageBox } from '@procesabpm/shared';
import type { DocumentMoment, WorkflowDocumentKind } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { MappedFieldRow, MappedSignatureRow } from '../domain/template-resolver.js';

export interface FormatSource {
  readonly id: string;
  readonly name: string;
  /** Stored JSON: parsed with the design schema before it is used. */
  readonly design: unknown;
  readonly fileNamePattern: string | null;
  readonly isActive: boolean;
}

export interface TemplateSource {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly storageKey: string;
  readonly fileConfirmed: boolean;
  readonly fields: readonly MappedFieldRow[];
  readonly signatures: readonly MappedSignatureRow[];
}

export interface WorkflowDocumentSource {
  readonly id: string;
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly kind: WorkflowDocumentKind;
  readonly moment: DocumentMoment | null;
  readonly isActive: boolean;
  readonly format: FormatSource | null;
  readonly template: TemplateSource | null;
}

/** What a workflow document draws from: its format or its uploaded template with the mapping. */
@Injectable()
export class DocumentSourceRepository {
  async findWorkflowDocument(tx: TenantTransaction, tenantId: string, id: string): Promise<WorkflowDocumentSource | null> {
    const row = await tx.workflowDocument.findFirst({
      where: { tenantId, id },
      select: {
        id: true,
        workflowId: true,
        companyId: true,
        kind: true,
        moment: true,
        isActive: true,
        format: { select: { id: true, name: true, design: true, fileNamePattern: true, isActive: true } },
        template: {
          select: {
            id: true,
            name: true,
            isActive: true,
            file: { select: { storageKey: true, status: true } },
            fields: { select: { mode: true, fieldCode: true, expression: true, acroformName: true, page: true, x: true, y: true, fontSize: true, maxWidth: true, align: true }, orderBy: { id: 'asc' } },
            signatures: { select: { mode: true, stepName: true, signerType: true, signerLabel: true, acroformName: true, page: true, x: true, y: true, width: true, height: true }, orderBy: { id: 'asc' } },
          },
        },
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      workflowId: row.workflowId,
      companyId: row.companyId,
      kind: row.kind,
      moment: row.moment,
      isActive: row.isActive,
      format: row.format,
      template:
        row.template === null
          ? null
          : {
              id: row.template.id,
              name: row.template.name,
              isActive: row.template.isActive,
              storageKey: row.template.file.storageKey,
              fileConfirmed: row.template.file.status === 'CONFIRMED',
              fields: row.template.fields.map((field) => ({ ...field, mode: field.mode })),
              signatures: row.template.signatures.map((signature) => ({ ...signature, mode: signature.mode, signerType: signature.signerType as MappedSignatureRow['signerType'] })),
            },
    };
  }

  /** The mapping of a template as the generation reads it. */
  async templateMapping(tx: TenantTransaction, tenantId: string, templateId: string): Promise<Pick<TemplateSource, 'fields' | 'signatures'>> {
    const row = await tx.pdfTemplate.findFirst({
      where: { tenantId, id: templateId },
      select: { fields: { orderBy: { id: 'asc' } }, signatures: { orderBy: { id: 'asc' } } },
    });
    return { fields: row?.fields ?? [], signatures: (row?.signatures ?? []).map((signature) => ({ ...signature, signerType: signature.signerType as MappedSignatureRow['signerType'] })) };
  }

  /** The pages and AcroForm fields found in the template PDF when it was registered. */
  async templateShape(tx: TenantTransaction, tenantId: string, templateId: string): Promise<{ pages: PageBox[]; acroformFields: AcroFieldInfo[] }> {
    const row = await tx.pdfTemplate.findFirst({ where: { tenantId, id: templateId }, select: { pages: true, acroformFields: true } });
    return { pages: (row?.pages ?? []) as unknown as PageBox[], acroformFields: (row?.acroformFields ?? []) as unknown as AcroFieldInfo[] };
  }

  async activeMomentDocuments(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<string[]> {
    const rows = await tx.workflowDocument.findMany({ where: { tenantId, workflowId, isActive: true, moment: { not: null } }, select: { id: true }, orderBy: { id: 'asc' } });
    return rows.map((row) => row.id);
  }

  /** Time zone and currency previews use: the tenant's time zone and its default company's currency. */
  async tenantLocale(tx: TenantTransaction, tenantId: string): Promise<{ timeZone: string; currencyCode: string }> {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { timeZone: true } });
    const company = await tx.company.findFirst({ where: { tenantId, isDefault: true }, select: { currencyCode: true } });
    return { timeZone: tenant?.timeZone ?? 'UTC', currencyCode: company?.currencyCode ?? 'COP' };
  }

  /**
   * The active documents that run at a moment for a ticket of this company: the ones made for the company if there are
   * any, otherwise the ones that apply to every company.
   */
  async activeForMoment(tx: TenantTransaction, tenantId: string, workflowId: string, companyId: string, moment: DocumentMoment): Promise<string[]> {
    const rows = await tx.workflowDocument.findMany({
      where: { tenantId, workflowId, moment, isActive: true, OR: [{ companyId }, { companyId: null }] },
      select: { id: true, companyId: true },
      orderBy: { id: 'asc' },
    });
    const own = rows.filter((row) => row.companyId === companyId);
    return (own.length > 0 ? own : rows).map((row) => row.id);
  }
}
