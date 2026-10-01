import { Inject, Injectable } from '@nestjs/common';
import { collectReferences, type ReferenceKind, type WorkflowProblem, type WorkflowValidation, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ReferenceCheckRepository } from '../data/reference-check.repository.js';

/**
 * The ids inside block and field configs (documents, exports, webhooks, datasets, people) have no foreign
 * key. Publishing checks that each exists, in this tenant, and where it applies to this workflow.
 */
@Injectable()
export class ReferenceValidator {
  constructor(@Inject(ReferenceCheckRepository) private readonly repository: ReferenceCheckRepository) {}

  async check(tx: TenantTransaction, tenantId: string, workflowId: string, doc: WorkflowVersionDocument): Promise<WorkflowProblem[]> {
    const references = collectReferences(doc);
    const kinds = [...new Set(references.map((reference) => reference.kind))];
    const problems: WorkflowProblem[] = [];
    for (const kind of kinds) {
      const ofKind = references.filter((reference) => reference.kind === kind);
      const existing = await this.repository.existing(tx, tenantId, workflowId, kind as ReferenceKind, [...new Set(ofKind.map((reference) => reference.id))]);
      for (const reference of ofKind.filter((candidate) => !existing.has(candidate.id))) {
        problems.push({
          code: 'BLOCK_REFERENCE_UNKNOWN',
          severity: 'error',
          ...(reference.stepId === undefined ? {} : { stepId: reference.stepId }),
          ...(reference.fieldId === undefined ? {} : { fieldId: reference.fieldId }),
          params: { kind, id: reference.id },
        });
      }
    }
    return problems;
  }
}

export function withProblems(validation: WorkflowValidation, extra: readonly WorkflowProblem[]): WorkflowValidation {
  return { errors: [...validation.errors, ...extra.filter((problem) => problem.severity === 'error')], warnings: [...validation.warnings, ...extra.filter((problem) => problem.severity === 'warning')] };
}
