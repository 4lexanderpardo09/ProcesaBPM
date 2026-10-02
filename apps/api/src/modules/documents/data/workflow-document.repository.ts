import { Injectable } from '@nestjs/common';
import type { DocumentMoment, WorkflowDocumentKind } from '@procesabpm/db';
import type { PageQuery } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface WorkflowDocumentRow {
  readonly id: string;
  readonly workflowId: string;
  readonly companyId: string | null;
  readonly kind: WorkflowDocumentKind;
  readonly formatId: string | null;
  readonly templateId: string | null;
  readonly moment: DocumentMoment | null;
  readonly isActive: boolean;
}

const SELECT = { id: true, workflowId: true, companyId: true, kind: true, formatId: true, templateId: true, moment: true, isActive: true } as const;

@Injectable()
export class WorkflowDocumentRepository {
  async list(tx: TenantTransaction, tenantId: string, workflowId: string, query: PageQuery): Promise<{ rows: WorkflowDocumentRow[]; total: number }> {
    const where = { tenantId, workflowId, ...(query.includeInactive ? {} : { isActive: true as const }) };
    const [rows, total] = await Promise.all([tx.workflowDocument.findMany({ where, select: SELECT, orderBy: { id: 'asc' }, ...pageWindow(query) }), tx.workflowDocument.count({ where })]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<WorkflowDocumentRow | null> {
    return tx.workflowDocument.findFirst({ where: { tenantId, workflowId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { workflowId: string; companyId: string | null; formatId: string | null; templateId: string | null; moment: DocumentMoment | null }): Promise<WorkflowDocumentRow> {
    return tx.workflowDocument.create({ data: { tenantId, ...data, kind: data.formatId === null ? 'TEMPLATE' : 'DESIGNED' }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, workflowId: string, id: string, data: { moment?: DocumentMoment | null; isActive?: boolean }): Promise<void> {
    await tx.workflowDocument.updateMany({ where: { tenantId, workflowId, id }, data });
  }

  async remove(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<void> {
    await tx.workflowDocument.deleteMany({ where: { tenantId, workflowId, id } });
  }

  /** Whether a DOCUMENT block of a version of this workflow names it: such a document cannot be deleted. */
  async isReferencedByBlock(tx: TenantTransaction, tenantId: string, workflowId: string, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM steps s JOIN workflow_versions v ON v.tenant_id = s.tenant_id AND v.id = s.version_id
      WHERE s.tenant_id = ${tenantId}::uuid AND v.workflow_id = ${workflowId}::uuid AND s.type = 'DOCUMENT' AND s.config->>'workflowDocumentId' = ${id} LIMIT 1`;
    return rows.length > 0;
  }
}
