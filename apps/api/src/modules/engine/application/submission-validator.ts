import { Inject, Injectable } from '@nestjs/common';
import {
  AmountLimitExceededError,
  type AmountEvaluation,
  captureFieldsFor,
  evaluateAmountRules,
  isDataReference,
  type FieldDocument,
  FieldValuesInvalidError,
  type FieldValueIssue,
  type StepDocument,
  validateCapturedValues,
  type WorkflowVersionDocument,
} from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { FieldReferenceRepository } from '../data/field-reference.repository.js';
import type { CompanyRow } from '../data/ticket-context.repository.js';
import { localDateIn } from '../domain/local-date.js';
import type { FieldWrite } from '../domain/plan.js';
import { type SubmissionFiles, SubmissionFilesChecker } from './submission-files.js';

export interface SubmissionRequest {
  readonly tenantId: string;
  readonly document: WorkflowVersionDocument;
  readonly stage: 'CREATION' | 'STEP';
  /** The block being answered (the START block when the ticket is created). */
  readonly step: StepDocument;
  readonly input: Readonly<Record<string, unknown>>;
  /** What the ticket already holds, by field code. */
  readonly existing: Readonly<Record<string, unknown>>;
  readonly company: CompanyRow;
  /** Position of the person submitting (for amount rules scoped to a position). */
  readonly positionId: string | null;
  readonly at: Date;
  /** The person submitting: they can only attach what they uploaded themselves. */
  readonly uploaderId: string;
  /** Uploads attached next to the fields (a comment's files, a closing document). */
  readonly attachmentIds: readonly string[];
}

export interface Submission {
  /** All values of the ticket after this submission, by field code: what conditions read. */
  readonly merged: Readonly<Record<string, unknown>>;
  readonly fieldWrites: readonly FieldWrite[];
  /** Values this submission changed, with what they were. */
  readonly changes: ReadonlyArray<{ readonly code: string; readonly before: unknown; readonly after: unknown }>;
  readonly amounts: AmountEvaluation;
  readonly files: SubmissionFiles;
}

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Validates what a person submitted for a block: field values (types, required, options, references to the
 * tenant's data) and the amount caps. Nothing is written; any problem is an error raised before the
 * movement starts. Values computed by the server (formulas) are never taken from the client.
 */
@Injectable()
export class SubmissionValidator {
  constructor(
    @Inject(FieldReferenceRepository) private readonly references: FieldReferenceRepository,
    @Inject(SubmissionFilesChecker) private readonly fileChecker: SubmissionFilesChecker,
  ) {}

  async validate(tx: TenantTransaction, request: SubmissionRequest): Promise<Submission> {
    const { document, step } = request;
    const fields = captureFieldsFor(document.fields, request.stage, step.id);
    const captured = validateCapturedValues({ fields, input: request.input, existing: request.existing, context: { today: localDateIn(request.company.timeZone, request.at) } });
    const issues: FieldValueIssue[] = [...captured.issues];
    if (issues.length === 0) {
      for (const code of await this.references.findInvalid(tx, request.tenantId, captured.references.filter(isDataReference))) issues.push({ code: 'NOT_FOUND', fieldCode: code });
    }
    if (issues.length > 0) throw new FieldValuesInvalidError(issues);

    const { files, issues: fileIssues } = await this.fileChecker.check(tx, {
      tenantId: request.tenantId,
      uploaderId: request.uploaderId,
      attachmentIds: request.attachmentIds,
      fileFieldCodes: fields.filter((field) => field.type === 'FILE').map((field) => field.code),
      capturedValues: captured.values,
      existing: request.existing,
      references: captured.references,
    });
    if (fileIssues.length > 0) throw new FieldValuesInvalidError(fileIssues);

    const merged = { ...request.existing, ...captured.values };
    const fieldByCode = new Map<string, FieldDocument>(document.fields.map((field) => [field.code, field]));
    const amounts = evaluateAmountRules(document.amountRules, fieldByCode, merged, {
      stepId: step.id,
      companyId: request.company.id,
      positionId: request.positionId,
      companyCurrency: request.company.currencyCode,
    });
    if (amounts.blocks.length > 0) throw new AmountLimitExceededError(amounts.blocks);

    const changes = Object.entries(captured.values)
      .filter(([code, value]) => !sameValue(request.existing[code], value))
      .map(([code, value]) => ({ code, before: request.existing[code] ?? null, after: value }));
    const fieldWrites = changes.map((change) => ({ fieldId: fieldByCode.get(change.code)!.id, value: change.after }));
    return { merged, fieldWrites, changes, amounts, files };
  }
}

/** The edge an EXTRA_APPROVAL rule sends the ticket through, from the block that was submitted. */
export function diversionEdge(document: WorkflowVersionDocument, amounts: AmountEvaluation, fromStepId: string): { transitionId: string; toStepId: string; ruleId: string } | undefined {
  const rule = amounts.diversion;
  if (rule === undefined || rule.approvalStepId === null) return undefined;
  const edge = document.transitions.find((transition) => transition.type === 'SYSTEM_ONLY' && transition.fromStepId === fromStepId && transition.toStepId === rule.approvalStepId);
  return edge === undefined ? undefined : { transitionId: edge.id, toStepId: edge.toStepId, ruleId: rule.id };
}
