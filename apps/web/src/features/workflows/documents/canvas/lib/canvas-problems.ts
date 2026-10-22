import { type PdfCanvasDesign, pdfCanvasDesignSchema, type PdfProblem, validateDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
import { elementOfPath } from './canvas-doc';

export const CANVAS_PROBLEM_CODES = [
  'DOCUMENT_FIELD_UNKNOWN',
  'DOCUMENT_FIELD_TYPE_MISMATCH',
  'DOCUMENT_ROW_OUTSIDE_TABLE',
  'DOCUMENT_TABLE_COLUMN_UNKNOWN',
  'DOCUMENT_SIGNATURE_STEP_UNKNOWN',
  'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE',
  'DOCUMENT_STEP_UNKNOWN',
  'DOCUMENT_CALCULATION_UNKNOWN',
  'DOCUMENT_CALCULATION_CODE_TAKEN',
  'DOCUMENT_FORMULA_INVALID',
  'DOCUMENT_IMAGE_UNKNOWN',
  'EXPRESSION_INVALID',
  'INCOMPLETE',
] as const;
export type CanvasProblemCode = (typeof CANVAS_PROBLEM_CODES)[number];

export interface CanvasProblem {
  readonly code: CanvasProblemCode;
  readonly detail: string;
  /** The element it is about; `undefined` for the page, the sheets and the calculations. */
  readonly elementId: string | undefined;
  /** Against the draft only: it matters when the draft is published. */
  readonly draftOnly: boolean;
}

const codeOf = (code: string): CanvasProblemCode => CANVAS_PROBLEM_CODES.find((candidate) => candidate === code) ?? 'INCOMPLETE';
const pathText = (path: readonly PropertyKey[]): string => path.map((part) => (typeof part === 'number' ? `[${String(part)}]` : `.${String(part)}`)).join('').replace(/^\./, '');

/** A formula's detail keeps its issue code; any other names the field, step or calculation first. */
const detailOf = (problem: PdfProblem) => (problem.code === 'DOCUMENT_FORMULA_INVALID' ? (problem.detail ?? '') : (problem.detail ?? '').split(' ')[0] ?? '');

/**
 * What stops the canvas from being saved, element by element: the format's own rules first (a table without its
 * field), then the shared validator against the version tickets run on, and against the draft for what the next
 * publication would break. The workflow's images are checked once they are known.
 */
export function canvasProblems(design: PdfCanvasDesign, current: WorkflowVersionDocument, draft: WorkflowVersionDocument | undefined, imageIds?: ReadonlySet<string>): CanvasProblem[] {
  const parsed = pdfCanvasDesignSchema.safeParse(design);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const expression = /^[A-Z_]+: /.test(issue.message);
      return { code: expression ? 'EXPRESSION_INVALID' : 'INCOMPLETE', detail: '', elementId: elementOfPath(design, pathText(issue.path)), draftOnly: false };
    });
  }
  const from = (problem: PdfProblem, draftOnly: boolean): CanvasProblem => ({ code: codeOf(problem.code), detail: detailOf(problem), elementId: elementOfPath(design, problem.path), draftOnly });
  const context = imageIds === undefined ? {} : { imageIds };
  const errors = validateDesign(design, current, context);
  const key = (problem: PdfProblem) => `${problem.code}|${problem.path}|${problem.detail ?? ''}`;
  const known = new Set(errors.map(key));
  const warnings = draft === undefined ? [] : validateDesign(design, draft, context).filter((problem) => !known.has(key(problem)));
  return [...errors.map((problem) => from(problem, false)), ...warnings.map((problem) => from(problem, true))];
}
