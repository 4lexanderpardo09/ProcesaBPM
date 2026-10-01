import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateAmountRuleRequest,
  type CreateFieldRequest,
  InvalidReferenceError,
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
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { DraftLock } from './draft-lock.js';

type StepChildren = Pick<StepDocument, 'candidates' | 'initiators' | 'signers' | 'slaOverrides' | 'files'>;

/**
 * Granular edits of a draft: fields, amount rules and the lists that hang from a block. Each one locks
 * the version (`FOR SHARE`) and refuses anything but a draft (409), then writes. The foreign keys of
 * positions, groups, users, companies and files of another tenant answer 422.
 */
@Injectable()
export class DraftEditorService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DraftLock) private readonly draftLock: DraftLock,
    @Inject(DraftContentRepository) private readonly content: DraftContentRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
  ) {}

  // ---- Fields ----
  createField(workflowId: string, versionId: string, request: CreateFieldRequest): Promise<FieldDocument> {
    return this.edit(workflowId, versionId, async (tx) => {
      this.assertFieldContent(request.type, request.config, request.dataSource);
      await this.requireStep(tx, versionId, request.stepId);
      const created = await this.content.createField(tx, this.tenantId, versionId, request);
      return this.field(tx, versionId, created.id);
    });
  }

  updateField(workflowId: string, versionId: string, fieldId: string, request: UpdateFieldRequest): Promise<FieldDocument> {
    return this.edit(workflowId, versionId, async (tx) => {
      const current = await this.content.findField(tx, this.tenantId, versionId, fieldId);
      if (current === null) throw new NotFoundError();
      this.assertFieldContent(current.type, request.config ?? current.config, request.dataSource === undefined ? current.dataSource : request.dataSource);
      if (request.stepId !== undefined) await this.requireStep(tx, versionId, request.stepId);
      await this.content.updateField(tx, this.tenantId, versionId, fieldId, compact(request));
      return this.field(tx, versionId, fieldId);
    });
  }

  deleteField(workflowId: string, versionId: string, fieldId: string): Promise<void> {
    return this.edit(workflowId, versionId, async (tx) => {
      if ((await this.content.deleteField(tx, this.tenantId, versionId, fieldId)) === 0) throw new NotFoundError();
    });
  }

  // ---- Amount rules (their foreign keys are not scoped to the version, so the blocks are checked here) ----
  createAmountRule(workflowId: string, versionId: string, request: CreateAmountRuleRequest): Promise<AmountRuleDocument> {
    return this.edit(workflowId, versionId, async (tx) => {
      await this.requireRuleSteps(tx, versionId, request);
      const created = await this.content.createAmountRule(tx, this.tenantId, versionId, request);
      return this.rule(tx, versionId, created.id);
    });
  }

  updateAmountRule(workflowId: string, versionId: string, ruleId: string, request: UpdateAmountRuleRequest): Promise<AmountRuleDocument> {
    return this.edit(workflowId, versionId, async (tx) => {
      await this.requireRuleSteps(tx, versionId, request);
      if ((await this.content.updateAmountRule(tx, this.tenantId, versionId, ruleId, compact(request))) === 0) throw new NotFoundError();
      return this.rule(tx, versionId, ruleId);
    });
  }

  deleteAmountRule(workflowId: string, versionId: string, ruleId: string): Promise<void> {
    return this.edit(workflowId, versionId, async (tx) => {
      if ((await this.content.deleteAmountRule(tx, this.tenantId, versionId, ruleId)) === 0) throw new NotFoundError();
    });
  }

  // ---- Lists of a block ----
  replaceCandidates(workflowId: string, versionId: string, stepId: string, request: ReplaceCandidatesRequest): Promise<StepChildren> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceCandidates(tx, this.tenantId, stepId, request));
  }

  replaceInitiators(workflowId: string, versionId: string, stepId: string, request: ReplaceInitiatorsRequest): Promise<StepChildren> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceInitiators(tx, this.tenantId, stepId, request));
  }

  replaceSigners(workflowId: string, versionId: string, stepId: string, request: ReplaceSignersRequest): Promise<StepChildren> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceSigners(tx, this.tenantId, stepId, request));
  }

  replaceSlaOverrides(workflowId: string, versionId: string, stepId: string, request: ReplaceSlaOverridesRequest): Promise<StepChildren> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceSlaOverrides(tx, this.tenantId, stepId, request));
  }

  replaceFiles(workflowId: string, versionId: string, stepId: string, request: ReplaceStepFilesRequest): Promise<StepChildren> {
    return this.editStep(workflowId, versionId, stepId, (tx) => this.content.replaceFiles(tx, this.tenantId, stepId, request));
  }

  private edit<T>(workflowId: string, versionId: string, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.draftLock.acquire(tx, this.tenantId, workflowId, versionId, 'SHARE');
      return work(tx);
    });
  }

  private editStep(workflowId: string, versionId: string, stepId: string, write: (tx: TenantTransaction) => Promise<void>): Promise<StepChildren> {
    return this.edit(workflowId, versionId, async (tx) => {
      await this.requireStep(tx, versionId, stepId);
      await write(tx);
      const step = (await this.documents.load(tx, this.tenantId, versionId)).steps.find((candidate) => candidate.id === stepId)!;
      return { candidates: step.candidates, initiators: step.initiators, signers: step.signers, slaOverrides: step.slaOverrides, files: step.files };
    });
  }

  private async requireStep(tx: TenantTransaction, versionId: string, stepId: string): Promise<void> {
    if (!(await this.content.stepBelongs(tx, this.tenantId, versionId, stepId))) throw new NotFoundError();
  }

  private async requireRuleSteps(tx: TenantTransaction, versionId: string, request: { stepId?: string | null | undefined; approvalStepId?: string | null | undefined }): Promise<void> {
    for (const stepId of [request.stepId, request.approvalStepId]) {
      if (stepId !== undefined && stepId !== null && !(await this.content.stepBelongs(tx, this.tenantId, versionId, stepId))) {
        throw new InvalidReferenceError('The block is not in this version');
      }
    }
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
