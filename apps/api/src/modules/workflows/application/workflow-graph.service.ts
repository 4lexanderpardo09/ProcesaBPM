import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidReferenceError,
  InvalidStateError,
  NotFoundError,
  parseBlockConfig,
  StaleRevisionError,
  type SaveGraphRequest,
  type SaveGraphResponse,
  type StepDocument,
  type TransitionDocument,
  type WorkflowValidation,
} from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';
import { countNewRefs, resolveReferences } from '../domain/graph-ids.js';
import { DraftLock } from './draft-lock.js';
import { ReferenceValidator, validateDocument, withProblems } from './reference-validator.js';

type StepRow = Omit<StepDocument, 'candidates' | 'initiators' | 'slaOverrides' | 'signers' | 'files'>;

/** Saves the canvas of a draft in one transaction, and validates a version without publishing it. */
@Injectable()
export class WorkflowGraphService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
    @Inject(DraftLock) private readonly draftLock: DraftLock,
    @Inject(ReferenceValidator) private readonly references: ReferenceValidator,
  ) {}

  /**
   * The blocks and transitions of the request replace the ones of the draft. Blocks keep their ids (their
   * fields, candidates, signers… hang from them and would be lost): the ones in the request are updated or
   * created, the ones missing are removed. A graph with problems is saved anyway (the canvas is work in
   * progress); only publishing requires a valid one. Everything the database already enforces (transition
   * rules, CHECKs, duplicate labels, foreign keys of other tenants) is left to it: its errors cancel the whole save.
   */
  save(workflowId: string, versionId: string, request: SaveGraphRequest): Promise<SaveGraphResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.tenantId;
      const { revision } = await this.draftLock.acquire(tx, tenantId, workflowId, versionId, 'UPDATE');
      if (request.revision !== undefined && request.revision !== revision) throw new StaleRevisionError(revision);

      const existingSteps = new Set((await this.documents.stepIdsOf(tx, tenantId, versionId)).map((row) => row.id));
      const existingTransitions = new Set((await this.documents.transitionIdsOf(tx, tenantId, versionId)).map((row) => row.id));
      const stepRefs = request.steps.map((step) => step.id);
      const transitionRefs = request.transitions.map((transition) => transition.id);
      const allocated = await this.documents.allocateIds(tx, countNewRefs(stepRefs) + countNewRefs(transitionRefs));
      const stepIds = resolveReferences(stepRefs, existingSteps, allocated.slice(0, countNewRefs(stepRefs)), 'block');
      const transitionIds = resolveReferences(transitionRefs, existingTransitions, allocated.slice(countNewRefs(stepRefs)), 'transition');

      const steps: StepRow[] = request.steps.map((step) => ({ ...step, id: stepIds.get(step.id)!, config: this.normalizedConfig(step) }));
      const transitions: TransitionDocument[] = request.transitions.map((transition) => ({
        ...transition,
        id: transitionIds.get(transition.id)!,
        fromStepId: this.stepRef(stepIds, transition.fromStepId),
        toStepId: this.stepRef(stepIds, transition.toStepId),
      }));

      const kept = new Set(steps.map((step) => step.id));
      const removed = [...existingSteps].filter((id) => !kept.has(id));
      // Transitions go first: they free the type-change and uniqueness rules for the rewritten blocks.
      await this.documents.deleteTransitions(tx, tenantId, versionId);
      if ((await this.documents.countRulesApprovedBy(tx, tenantId, versionId, removed)) > 0) {
        throw new InvalidStateError('A removed block is the extra approval step of an amount rule: change the rule first');
      }
      await this.documents.deleteRulesOfSteps(tx, tenantId, versionId, removed);
      await this.documents.deleteSteps(tx, tenantId, versionId, removed);
      for (const step of steps.filter((candidate) => existingSteps.has(candidate.id))) await this.documents.updateStep(tx, tenantId, versionId, step);
      await this.documents.insertSteps(tx, tenantId, versionId, steps.filter((candidate) => !existingSteps.has(candidate.id)));
      await this.documents.insertTransitions(tx, tenantId, versionId, transitions);

      const document = await this.documents.load(tx, tenantId, versionId);
      return {
        revision: await this.workflows.bumpRevision(tx, tenantId, versionId),
        idMap: Object.fromEntries([...stepIds, ...transitionIds].filter(([ref, id]) => ref !== id)),
        document,
        validation: validateDocument(document),
      };
    });
  }

  validate(workflowId: string, versionId: string): Promise<WorkflowValidation> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.workflows.findVersion(tx, this.tenantId, workflowId, versionId)) === null) throw new NotFoundError();
      const document = await this.documents.load(tx, this.tenantId, versionId);
      return withProblems(validateDocument(document), await this.references.check(tx, this.tenantId, workflowId, document));
    });
  }

  /** A transition may only join blocks of the request: any other id is refused (422), never trusted. */
  private stepRef(stepIds: ReadonlyMap<string, string>, ref: string): string {
    const id = stepIds.get(ref);
    if (id === undefined) throw new InvalidReferenceError('A transition joins a block that is not in the request');
    return id;
  }

  /** The normalized config (defaults applied) when valid; as sent otherwise, for the validator to report. */
  private normalizedConfig(step: SaveGraphRequest['steps'][number]): Record<string, unknown> {
    const parsed = parseBlockConfig(step.type, step.config);
    return parsed.valid ? parsed.config : step.config;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
