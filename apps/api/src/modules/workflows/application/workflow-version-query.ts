import { Inject, Injectable } from '@nestjs/common';
import type { WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';

export interface WorkflowVersions {
  /** What tickets run on now: problems against it block the change. */
  readonly published: WorkflowVersionDocument | null;
  /** What is being edited: problems against it are warnings. */
  readonly draft: WorkflowVersionDocument | null;
}

/** Read access for other modules to the content of a workflow's current versions. */
@Injectable()
export class WorkflowVersionQuery {
  constructor(@Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository) {}

  /** `null` when the workflow does not exist in this tenant. */
  async current(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<WorkflowVersions | null> {
    if ((await tx.workflow.count({ where: { tenantId, id: workflowId } })) === 0) return null;
    const versions = await tx.workflowVersion.findMany({ where: { tenantId, workflowId, status: { in: ['PUBLISHED', 'DRAFT'] } }, select: { id: true, status: true } });
    const load = async (status: 'PUBLISHED' | 'DRAFT') => {
      const version = versions.find((candidate) => candidate.status === status);
      return version === undefined ? null : this.documents.load(tx, tenantId, version.id);
    };
    return { published: await load('PUBLISHED'), draft: await load('DRAFT') };
  }
}
