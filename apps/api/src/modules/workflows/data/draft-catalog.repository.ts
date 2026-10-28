import { Injectable } from '@nestjs/common';
import type { DraftCatalog } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** The names a draft template may use (`WorkflowDraftSpec`): active positions and groups, and the approval group types. No people. */
@Injectable()
export class DraftCatalogRepository {
  async load(tx: TenantTransaction, tenantId: string): Promise<DraftCatalog> {
    const [positions, groups, approvalTypes] = await Promise.all([
      tx.position.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      tx.group.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      tx.approvalGroupType.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { positions, groups, approvalTypes };
  }
}
