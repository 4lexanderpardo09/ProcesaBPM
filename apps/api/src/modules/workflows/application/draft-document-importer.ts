import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ERROR_CODES, remapVersionDocument, StaleRevisionError, type WorkflowProblem, type WorkflowValidation, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { WorkflowRepository } from '../data/workflow.repository.js';
import { DraftLock } from './draft-lock.js';
import { normalizeStepContent } from './step-normalizer.js';
import { ReferenceValidator, validateDocument, withProblems } from './reference-validator.js';

/**
 * Problems the database itself would refuse (transition rules, CHECKs, unique labels): a document with any of
 * them is not written at all. Every other design problem is saved, as the canvas does, for the person to fix.
 */
export const IMPORT_BLOCKING_CODES: ReadonlySet<string> = new Set([
  'TRANSITION_TYPE_NOT_ALLOWED',
  'TRANSITION_DUPLICATE_DEFAULT',
  'TRANSITION_LABEL_DUPLICATE',
  'TRANSITION_UNKNOWN_BLOCK',
  'TRANSITION_FROM_END',
  'TRANSITION_TO_START',
  'CONDITION_RULE_MISSING',
  'COMMENT_ONLY_ON_DECISION',
  'ASSIGNMENT_MODE_INVALID',
  'AUTOMATIC_BLOCK_WITH_SLA',
  'CHILDREN_ON_AUTOMATIC_BLOCK',
  'APPROVER_CONFIG_MISSING',
  'POSITION_MISSING',
  'SAME_STEP_MISSING',
  'SAME_STEP_INVALID',
  'STEP_NAME_DUPLICATE',
  'FIELD_CODE_DUPLICATE',
]);

export class DraftImportRejectedError extends DomainError {
  constructor(readonly problems: readonly WorkflowProblem[]) {
    super(ERROR_CODES.validationFailed, 'The document breaks rules the database enforces', { details: { codes: [...new Set(problems.map((problem) => problem.code))] } });
  }
}

export interface DraftImport {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly versionId: string;
  /** The revision the requester saw: a draft edited since then is not overwritten. */
  readonly expectedRevision: number;
  /** A document with `new:` ids (or any ids: they are all replaced). */
  readonly document: WorkflowVersionDocument;
}

export function blockingProblems(document: WorkflowVersionDocument): WorkflowProblem[] {
  return validateDocument(document).errors.filter((problem) => IMPORT_BLOCKING_CODES.has(problem.code));
}

/**
 * Replaces the whole content of a draft with a document, inside the caller's transaction: either all of it is
 * written or nothing changes. Used by «Crear con IA»; the canvas keeps its own incremental save.
 */
@Injectable()
export class DraftDocumentImporter {
  constructor(
    @Inject(WorkflowRepository) private readonly workflows: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
    @Inject(DraftLock) private readonly draftLock: DraftLock,
    @Inject(ReferenceValidator) private readonly references: ReferenceValidator,
  ) {}

  async replaceContent(tx: TenantTransaction, request: DraftImport): Promise<{ revision: number; validation: WorkflowValidation }> {
    const blocking = blockingProblems(request.document);
    if (blocking.length > 0) throw new DraftImportRejectedError(blocking);
    const { tenantId, workflowId, versionId } = request;
    const { revision } = await this.draftLock.acquire(tx, tenantId, workflowId, versionId);
    if (revision !== request.expectedRevision) throw new StaleRevisionError(revision);

    await this.documents.deleteContent(tx, tenantId, versionId);
    const normalized: WorkflowVersionDocument = { ...request.document, steps: request.document.steps.map((step) => ({ ...step, ...normalizeStepContent(step) })) };
    const ids = await this.documents.allocateIds(tx, idsNeeded(normalized));
    let next = 0;
    await this.documents.insertDocument(tx, tenantId, versionId, remapVersionDocument(normalized, () => ids[next++]!));

    const stored = await this.documents.load(tx, tenantId, versionId);
    return {
      revision: await this.workflows.bumpRevision(tx, tenantId, versionId),
      validation: withProblems(validateDocument(stored), await this.references.check(tx, tenantId, workflowId, stored)),
    };
  }
}

function idsNeeded(doc: WorkflowVersionDocument): number {
  const children = doc.steps.reduce((sum, step) => sum + step.candidates.length + step.initiators.length + step.signers.length, 0);
  return doc.steps.length + doc.transitions.length + doc.fields.length + doc.amountRules.length + children;
}
