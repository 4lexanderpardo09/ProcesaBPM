import { Injectable } from '@nestjs/common';
import type { ReferenceKind } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** Which of the given ids exist where a workflow may use them (the workflow's own records, or the tenant's). */
@Injectable()
export class ReferenceCheckRepository {
  async existing(tx: TenantTransaction, tenantId: string, workflowId: string, kind: ReferenceKind, ids: readonly string[]): Promise<Set<string>> {
    const wanted = [...ids];
    const select = { id: true } as const;
    const rows = await (async (): Promise<Array<{ id: string }>> => {
      switch (kind) {
        case 'WORKFLOW_DOCUMENT':
          return tx.workflowDocument.findMany({ where: { tenantId, workflowId, id: { in: wanted } }, select });
        case 'EXPORT_DEFINITION':
          return tx.exportDefinition.findMany({ where: { tenantId, workflowId, id: { in: wanted } }, select });
        case 'WEBHOOK':
          return tx.webhook.findMany({ where: { tenantId, id: { in: wanted } }, select });
        case 'DATASET':
          return tx.dataset.findMany({ where: { tenantId, id: { in: wanted }, OR: [{ workflowId }, { workflowId: null }] }, select });
        case 'POSITION':
          return tx.position.findMany({ where: { tenantId, id: { in: wanted } }, select });
        case 'GROUP':
          return tx.group.findMany({ where: { tenantId, id: { in: wanted } }, select });
        case 'USER':
          return (await tx.membership.findMany({ where: { tenantId, userId: { in: wanted } }, select: { userId: true } })).map((row) => ({ id: row.userId }));
      }
    })();
    return new Set(rows.map((row) => row.id));
  }
}
