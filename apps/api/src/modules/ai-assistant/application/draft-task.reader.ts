import { Inject, Injectable } from '@nestjs/common';
import type { DraftCatalog } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DraftSpecReader } from '../../workflows/application/draft-spec-reader.js';
import { DraftCatalogRepository } from '../../workflows/data/draft-catalog.repository.js';
import { WorkflowRepository } from '../../workflows/data/workflow.repository.js';
import { AiJobWorkRepository, type DraftJobInput } from '../data/ai-job-work.repository.js';
import { type DraftTask, PAST_TURN_LIMITS } from '../domain/prompt-builder.js';

export type ReadDraftTask =
  | { readonly kind: 'ready'; readonly input: DraftJobInput; readonly catalog: DraftCatalog; readonly task: DraftTask }
  /** Ends the request before any paid call. */
  | { readonly kind: 'failed'; readonly errorCode: 'AI_JOB_INVALID' | 'AI_DISABLED' | 'DRAFT_GONE' | 'DRAFT_CHANGED' | 'AI_DRAFT_NOT_REVISABLE' };

/**
 * What a claimed request asks the model, read in the tenant's transaction. A revision is built here from the draft as
 * it is in the database (never from what the browser sent): it must still be the draft at the revision the person
 * saw, and one the spec can carry whole; its earlier requests go along as context.
 */
@Injectable()
export class DraftTaskReader {
  constructor(
    @Inject(AiJobWorkRepository) private readonly work: AiJobWorkRepository,
    @Inject(DraftCatalogRepository) private readonly catalogs: DraftCatalogRepository,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(DraftSpecReader) private readonly drafts: DraftSpecReader,
  ) {}

  async read(tx: TenantTransaction, tenantId: string, jobId: string): Promise<ReadDraftTask> {
    const input = await this.work.draftInput(tx, tenantId, jobId);
    if (input === undefined) return { kind: 'failed', errorCode: 'AI_JOB_INVALID' };
    if (!input.enabled) return { kind: 'failed', errorCode: 'AI_DISABLED' };
    if (input.kind === 'WORKFLOW_DRAFT') return { kind: 'ready', input, catalog: await this.catalogs.load(tx, tenantId), task: { kind: 'create', description: input.description } };

    const version = await this.workflows.findVersion(tx, tenantId, input.workflowId, input.versionId);
    if (version === null || version.status !== 'DRAFT') return { kind: 'failed', errorCode: 'DRAFT_GONE' };
    if (version.revision !== input.expectedRevision) return { kind: 'failed', errorCode: 'DRAFT_CHANGED' };
    const { catalog, extraction } = await this.drafts.read(tx, tenantId, input.versionId);
    if (extraction.kind !== 'spec') return { kind: 'failed', errorCode: 'AI_DRAFT_NOT_REVISABLE' };
    const history = await this.work.pastRequests(tx, tenantId, input.versionId, { id: jobId, createdAt: input.createdAt }, PAST_TURN_LIMITS.turns);
    return { kind: 'ready', input, catalog, task: { kind: 'revise', message: input.description, basis: extraction.basis, history } };
  }
}
