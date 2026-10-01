import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateAmountRuleRequest,
  type CreateFieldRequest,
  NotFoundError,
  parseFieldConfig,
  checkFieldDataSource,
  type ReplaceCandidatesRequest,
  type ReplaceInitiatorsRequest,
  type ReplaceSignersRequest,
  type ReplaceSlaOverridesRequest,
  type ReplaceStepFilesRequest,
  type StepDocument,
  type UpdateAmountRuleRequest,
  type UpdateFieldRequest,
  ValidationFailedError,
  type AmountRuleDocument,
  type FieldDocument,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DraftContentRepository } from '../data/draft-content.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { DraftLock } from './draft-lock.js';

/** What a granular edit answers with, and the revision of the draft after it (the controller puts it in a header). */
export interface Edited<T> {
  readonly value: T;
  readonly revision: number;
}

type StepChildren = Pick<StepDocument, 'candidates' | 'initiators' | 'signers' | 'slaOverrides' | 'files'>;

/**
 * Granular edits of a draft: fields, amount rules and the lists that hang from a block. Each one locks
 * the version (`FOR UPDATE`) and refuses anything but a draft (409), writes, and bumps the revision, so a canvas
 * saved from an older read is refused (409) instead of silently overwriting the edit. The foreign keys of
 * positions, groups, users, companies and files of another tenant answer 422.
 */
@Injectable()
export class DraftEditorService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DraftLock) private readonly draftLock: DraftLock,
    @Inject(DraftContentRepository) private readonly content: DraftContentRepository,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
  ) {}

  // ---- Fields ----
  createField(workflowId: string, versionId: string, request: CreateFieldRequest): Promise<Edited<FieldDocument>> {
    return this.edit(workflowId, versionId, async (tx) => {
      this.assertFieldContent(request.type, request.config, request.dataSource);
      await this.requireStep(tx, versionId, request.stepId);
      const created = await this.content.createField(tx, this.tenantId, versionId, request);
      return this.field(tx, versionId, created.id);
    });
  }

  updateField(workflowId: string, versionId: string, fieldId: string, request: UpdateFieldRequest): Promise<Edited<FieldDocument>> {
    return this.edit(workflowId, versionId, async (tx) => {
      const current = await this.content.findField(tx, this.tenantId, versionId, fieldId);
      if (current === null) throw new NotFoundError();
      this.assertFieldContent(current.type, request.config ?? current.config, request.dataSource === undefined ? current.dataSource : request.dataSource);
      if (request.stepId !== undefined) await this.requireStep(tx, versionId, request.stepId);
      await this.content.updateField(tx, this.tenantId, versionId, fieldId, compact(request));
      return this.field(tx, versionId, fieldId);
    });
  }

  deleteField(workflowId: string, versionId: string, fieldId: string): Promise<Edited<void>> {
    return this.edit(workflowId, versionId, async (tx) => {
      if ((await this.content.deleteField(tx, this.tenantId, versionId, fieldId)) === 0) throw new NotFoundError();
    });
  }

  // ---- Amount rules (the foreign keys are scoped to the version: a block of another one is refused by the database, 422) ----
  createAmountRule(workflowId: string, versionId: string, request: CreateAmountRuleRequest): Promise<Edited<AmountRuleDocument>> {
    return this.edit(workflowId, versionId, async (tx) => {
      const created = await this.content.createAmountRule(tx, this.tenantId, versionId, request);
      return this.rule(tx, versionId, created.id);
    });
  }

  updateAmountRule(workflowId: string, versionId: string, ruleId: string, request: UpdateAmountRuleRequest): Promise<Edited<AmountRuleDocument>> {
    return this.edit(workflowId, versionId, async (tx) => {
      if ((await this.content.updateAmountRule(tx, this.tenantId, versionId, ruleId, compact(request))) === 0) throw new NotFoundError();
      return this.rule(tx, versionId, ruleId);
    });
  }

  deleteAmountRule(workflowId: string, versionId: string, ruleId: string): Promise<Edited<void>> {
    return this.edit(workflowId, versionId, async (tx) => {
      if ((await this.content.deleteAmountRule(tx, this.tenantId, versionId, ruleId)) === 0) throw new NotFoundError();
    });
  }

  // ---- Lists of a block ----
  replaceCandidates(workflowId: string, versionId: string, stepId: string, request: ReplaceCandidatesRequest): Promise<Edited<StepChildren>> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceCandidates(tx, this.tenantId, stepId, request));
  }

  replaceInitiators(workflowId: string, versionId: string, stepId: string, request: ReplaceInitiatorsRequest): Promise<Edited<StepChildren>> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceInitiators(tx, this.tenantId, stepId, request));
  }

  replaceSigners(workflowId: string, versionId: string, stepId: string, request: ReplaceSignersRequest): Promise<Edited<StepChildren>> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceSigners(tx, this.tenantId, stepId, request));
  }

  replaceSlaOverrides(workflowId: string, versionId: string, stepId: string, request: ReplaceSlaOverridesRequest): Promise<Edited<StepChildren>> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceSlaOverrides(tx, this.tenantId, stepId, request));
  }

  replaceFiles(workflowId: string, versionId: string, stepId: string, request: ReplaceStepFilesRequest): Promise<Edited<StepChildren>> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceFiles(tx, this.tenantId, stepId, request));
  }

  private edit<T>(workflowId: string, versionId: string, work: (tx: TenantTransaction) => Promise<T>): Promise<Edited<T>> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.draftLock.acquire(tx, this.tenantId, workflowId, versionId);
      const value = await work(tx);
      return { value, revision: await this.workflows.bumpRevision(tx, this.tenantId, versionId) };
    });
  }

  private editStep(workflowId: string, versionId: string, stepId: string, write: (tx: TenantTransaction) => Promise<void>): Promise<Edited<StepChildren>> {
    return this.edit(workflowId, versionId, async (tx) => {
      if (!(await this.content.stepBelongs(tx, this.tenantId, versionId, stepId))) throw new NotFoundError();
      await write(tx);
      const step = (await this.documents.load(tx, this.tenantId, versionId)).steps.find((candidate) => candidate.id === stepId)!;
      return { candidates: step.candidates, initiators: step.initiators, signers: step.signers, slaOverrides: step.slaOverrides, files: step.files };
    });
  }

  private async requireStep(tx: TenantTransaction, versionId: string, stepId: string): Promise<void> {
    if (!(await this.content.stepBelongs(tx, this.tenantId, versionId, stepId))) throw new NotFoundError();
  }

  private assertFieldContent(type: FieldDocument['type'], config: unknown, dataSource: unknown): void {
    const parsed = parseFieldConfig(type, config, dataSource);
    const source = checkFieldDataSource(type, dataSource);
    const issues = [...(parsed.valid ? [] : parsed.issues), ...(source.valid ? [] : source.issues)];
    if (issues.length > 0) throw new ValidationFailedError(issues.map((message) => ({ path: 'config', message })));
  }

  private async field(tx: TenantTransaction, versionId: string, id: string): Promise<FieldDocument> {
    return (await this.documents.load(tx, this.tenantId, versionId)).fields.find((field) => field.id === id)!;
  }

  private async rule(tx: TenantTransaction, versionId: string, id: string): Promise<AmountRuleDocument> {
    return (await this.documents.load(tx, this.tenantId, versionId)).amountRules.find((rule) => rule.id === id)!;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
