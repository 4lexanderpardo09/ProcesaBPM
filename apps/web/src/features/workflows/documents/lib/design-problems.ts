import { type PdfDesign, pdfDesignSchema, type PdfProblem, validateDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
import { type BlockRef, blockOfPath } from './design-doc';

/** Codes the shared validator gives, plus `INCOMPLETE` for a block the format's own rules refuse (a table without its field). */
export const DESIGN_PROBLEM_CODES = [
  'DOCUMENT_FIELD_UNKNOWN',
  'DOCUMENT_FIELD_TYPE_MISMATCH',
  'DOCUMENT_ROW_OUTSIDE_TABLE',
  'DOCUMENT_TABLE_COLUMN_UNKNOWN',
  'DOCUMENT_SIGNATURE_STEP_UNKNOWN',
  'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE',
  'DOCUMENT_STEP_UNKNOWN',
  'PAGE_AND_PAGES_OUTSIDE_BAND',
  'EXPRESSION_INVALID',
  'INCOMPLETE',
] as const;
export type DesignProblemCode = (typeof DESIGN_PROBLEM_CODES)[number];

export interface DesignProblem {
  readonly code: DesignProblemCode;
  readonly detail: string;
  /** The block it is about; `undefined` for the page settings. */
  readonly block: BlockRef | undefined;
  /** Against the draft only: tickets do not run on it yet, but publishing it would break the format. */
  readonly draftOnly: boolean;
}

const codeOf = (code: string): DesignProblemCode => DESIGN_PROBLEM_CODES.find((candidate) => candidate === code) ?? 'INCOMPLETE';

/** The field or step a detail names: "X is not a table" names X. */
const subjectOf = (detail: string | undefined): string => (detail ?? '').split(' ')[0] ?? '';

const fromShared = (problem: PdfProblem, draftOnly: boolean): DesignProblem => ({
  code: codeOf(problem.code),
  detail: problem.code === 'EXPRESSION_INVALID' ? '' : subjectOf(problem.detail),
  block: blockOfPath(problem.path),
  draftOnly,
});

/** Zod paths are arrays: `['body', 2, 'fieldCode']` reads as `body[2].fieldCode`. */
const pathText = (path: readonly PropertyKey[]): string => path.map((part) => (typeof part === 'number' ? `[${String(part)}]` : `.${String(part)}`)).join('').replace(/^\./, '');

/**
 * What stops the format, block by block. The format's own rules come first (an unfinished block cannot be saved); then
 * the shared validator against the version tickets run on (the published one, or the draft while nothing is published),
 * and against the draft for what the next publication would break.
 */
export function designProblems(design: PdfDesign, current: WorkflowVersionDocument, draft: WorkflowVersionDocument | undefined): DesignProblem[] {
  const parsed = pdfDesignSchema.safeParse(design);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const expression = typeof issue.message === 'string' && /^[A-Z_]+: /.test(issue.message);
      return { code: expression ? 'EXPRESSION_INVALID' : 'INCOMPLETE', detail: '', block: blockOfPath(pathText(issue.path)), draftOnly: false };
    });
  }
  const errors = validateDesign(design, current);
  const key = (problem: PdfProblem) => `${problem.code}|${problem.path}|${problem.detail ?? ''}`;
  const known = new Set(errors.map(key));
  const warnings = draft === undefined ? [] : validateDesign(design, draft).filter((problem) => !known.has(key(problem)));
  return [...errors.map((problem) => fromShared(problem, false)), ...warnings.map((problem) => fromShared(problem, true))];
}
