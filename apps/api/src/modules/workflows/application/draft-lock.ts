import { Inject, Injectable } from '@nestjs/common';
import { ImmutableDataError, NotFoundError } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WorkflowRepository } from '../data/workflow.repository.js';

/**
 * Every edit of a version starts here. It locks the version row and refuses anything that is not a
 * draft. The lock matters: the database guards only look at the status they read, and an edit that read
 * DRAFT could otherwise commit after a publish and change a published version.
 */
@Injectable()
export class DraftLock {
  constructor(@Inject(WorkflowRepository) private readonly workflows: WorkflowRepository) {}

  /** `SHARE` for a granular edit (publishing waits for it), `UPDATE` for rewriting or deleting the draft. */
  async acquire(tx: TenantTransaction, tenantId: string, workflowId: string, versionId: string, mode: 'SHARE' | 'UPDATE'): Promise<void> {
    const status = await this.workflows.lockVersion(tx, tenantId, workflowId, versionId, mode);
    if (status === undefined) throw new NotFoundError();
    if (status !== 'DRAFT') throw new ImmutableDataError(`The version is ${status.toLowerCase()} and cannot be edited`);
  }
}
