import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateVersionRequest,
  NotFoundError,
  remapVersionDocument,
  type VersionDetailResponse,
  type VersionSummary,
} from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';
import { DraftLock } from './draft-lock.js';
import { validateDocument } from './reference-validator.js';
import { toVersionSummary } from './version-summary.js';

/** Versions of a workflow: copy into a new draft, read the whole version, delete a draft. */
@Injectable()
export class WorkflowVersionsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
    @Inject(DraftLock) private readonly draftLock: DraftLock,
  ) {}

  /**
   * A new draft, empty or a deep copy of a version of the same workflow (new ids everywhere, references
   * rewired). The workflow row is locked, so two creations number their versions one after the other;
   * a second draft is refused by the one-draft index (409).
   */
  create(workflowId: string, request: CreateVersionRequest): Promise<VersionSummary> {
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.workflows.lockWorkflow(tx, this.tenantId, workflowId))) throw new NotFoundError();
      const source = request.fromVersionId === undefined ? undefined : await this.workflows.findVersion(tx, this.tenantId, workflowId, request.fromVersionId);
      if (request.fromVersionId !== undefined && source === null) throw new NotFoundError();
      const number = await this.workflows.nextVersionNumber(tx, this.tenantId, workflowId);
      const version = await this.workflows.createVersion(tx, this.tenantId, { workflowId, number, ...(request.notes === undefined ? {} : { notes: request.notes }) });
      if (source !== undefined && source !== null) await this.copyInto(tx, source.id, version.id);
      return toVersionSummary(version);
    });
  }

  get(workflowId: string, versionId: string): Promise<VersionDetailResponse> {
    return this.runner.withTenantTransaction((tx) => this.read(tx, workflowId, versionId));
  }

  /** Only a draft can be deleted: published and archived versions are history that tickets point to. */
  deleteDraft(workflowId: string, versionId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.draftLock.acquire(tx, this.tenantId, workflowId, versionId);
      await this.workflows.deleteVersion(tx, this.tenantId, versionId);
    });
  }

  private async copyInto(tx: TenantTransaction, sourceId: string, targetId: string): Promise<void> {
    const source = await this.documents.load(tx, this.tenantId, sourceId);
    const needed = source.steps.length + source.transitions.length + source.fields.length + source.amountRules.length + source.steps.reduce((sum, step) => sum + step.candidates.length + step.initiators.length + step.signers.length, 0);
    const ids = await this.documents.allocateIds(tx, needed);
    let next = 0;
    const copy = remapVersionDocument(source, () => ids[next++]!);
    await this.documents.insertDocument(tx, this.tenantId, targetId, copy);
  }

  private async read(tx: TenantTransaction, workflowId: string, versionId: string): Promise<VersionDetailResponse> {
    const workflow = await this.workflows.findById(tx, this.tenantId, workflowId);
    const version = await this.workflows.findVersion(tx, this.tenantId, workflowId, versionId);
    if (workflow === null || version === null) throw new NotFoundError();
    const document = await this.documents.load(tx, this.tenantId, versionId);
    return {
      workflow: { id: workflow.id, name: workflow.name, subcategoryId: workflow.subcategoryId },
      version: toVersionSummary(version),
      document,
      validation: version.status === 'DRAFT' ? validateDocument(document) : null,
    };
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
