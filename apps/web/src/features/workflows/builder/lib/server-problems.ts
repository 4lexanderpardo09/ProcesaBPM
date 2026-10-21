import type { WorkflowProblem, WorkflowValidation } from '@procesabpm/shared';
import { ApiError } from '@/shared/api';

/** Checks only the API can run (they read the tenant's data): the canvas cannot repeat them, so it keeps what publishing said. */
const SERVER_ONLY_CODES: ReadonlySet<string> = new Set(['BLOCK_REFERENCE_UNKNOWN', 'CALCULATOR_NOT_CONFIGURED', 'DOCUMENT_SOURCE_NOT_FOUND', 'DOCUMENT_SOURCE_INACTIVE']);

const isProblem = (value: unknown): value is WorkflowProblem =>
  typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string' && ((value as { severity?: unknown }).severity === 'error' || (value as { severity?: unknown }).severity === 'warning');

/** The problems of a refused publication (422 `WORKFLOW_NOT_PUBLISHABLE`) that the canvas does not find by itself. */
export function serverOnlyProblems(error: unknown): WorkflowProblem[] {
  if (!(error instanceof ApiError) || error.code !== 'WORKFLOW_NOT_PUBLISHABLE') return [];
  const details = error.details as { errors?: unknown; warnings?: unknown } | undefined;
  const all = [...(Array.isArray(details?.errors) ? details.errors : []), ...(Array.isArray(details?.warnings) ? details.warnings : [])];
  return all.filter(isProblem).filter((problem) => SERVER_ONLY_CODES.has(problem.code));
}

export function withServerProblems(validation: WorkflowValidation, extra: readonly WorkflowProblem[]): WorkflowValidation {
  if (extra.length === 0) return validation;
  return { errors: [...validation.errors, ...extra.filter((problem) => problem.severity === 'error')], warnings: [...validation.warnings, ...extra.filter((problem) => problem.severity === 'warning')] };
}
