import { Inject, Injectable } from '@nestjs/common';
import {
  ImmutableDataError,
  NotFoundError,
  type PublishVersionRequest,
  type PublishVersionResponse,
  validateWorkflowGraph,
  WorkflowNotPublishableError,
} from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';
import { toVersionSummary } from './version-summary.js';

/** Publishes a draft: validate, archive the published version and publish the draft, all or nothing. */
@Injectable()
export class WorkflowPublicationService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
  ) {}

  /**
   * Locks the workflow and then the version (the same order everywhere, so nothing deadlocks). Two
   * publications queue on the workflow lock and the second finds a published version (409); an edit that is
   * still running holds a lock on the version, which this waits for. Errors in the draft cancel the
   * publication before anything is written (422 with the whole list).
   */
  publish(workflowId: string, versionId: string, publishedById: string, request: PublishVersionRequest): Promise<PublishVersionResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.tenantId;
      if (!(await this.workflows.lockWorkflow(tx, tenantId, workflowId))) throw new NotFoundError();
      const status = await this.workflows.lockVersion(tx, tenantId, workflowId, versionId, 'UPDATE');
      if (status === undefined) throw new NotFoundError();
      if (status !== 'DRAFT') throw new ImmutableDataError(`The version is ${status.toLowerCase()}: only a draft is published`);

      const validation = validateWorkflowGraph(await this.documents.load(tx, tenantId, versionId));
      if (validation.errors.length > 0) throw new WorkflowNotPublishableError(validation);

      await this.workflows.archivePublished(tx, tenantId, workflowId);
      if ((await this.workflows.publish(tx, tenantId, versionId, publishedById, request.notes)) !== 1) throw new ImmutableDataError('The version is no longer a draft');
      const version = (await this.workflows.findVersion(tx, tenantId, workflowId, versionId))!;
      return { version: toVersionSummary(version), warnings: validation.warnings };
    });
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
