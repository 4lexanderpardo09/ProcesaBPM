import { type AcroFieldInfo, type MappedField, type MappedSignature, type PageBox, type PdfProblem, type TemplateMapping, templateMappingSchema, validateMapping, type WorkflowVersionDocument } from '@procesabpm/shared';

export type ItemKind = 'fields' | 'signatures';

export interface ItemRef {
  readonly kind: ItemKind;
  readonly index: number;
}

export const sameItem = (a: ItemRef | undefined, b: ItemRef | undefined): boolean => a !== undefined && b !== undefined && a.kind === b.kind && a.index === b.index;

const DEFAULT_FONT_SIZE = 10;
const DEFAULT_SIGNATURE = { width: 150, height: 50 } as const;

/** A value placed by position until the person places it (or picks a form field); it names nothing yet. */
export const newField = (): MappedField => ({ mode: 'COORDINATES', fieldCode: '', page: 1, x: 0, y: 0, fontSize: DEFAULT_FONT_SIZE }) as MappedField;

export const newSignature = (): MappedSignature => ({ mode: 'COORDINATES', stepName: '', signerType: 'STEP_ASSIGNEE', page: 1, x: 0, y: 0, ...DEFAULT_SIGNATURE });

/** Points are kept to one decimal: finer than anyone can click, and what the person reads back. */
const round = (value: number) => Math.round(value * 10) / 10;

/** Moves the item to where the person clicked: for a value, the start of its first line; for a signature, its lower-left corner. */
export function placeAt<T extends MappedField | MappedSignature>(item: T, page: number, x: number, y: number): T {
  return { ...item, mode: 'COORDINATES', page, x: round(Math.max(0, x)), y: round(Math.max(0, y)) };
}

/** Switches how the item is placed: by position (with defaults) or into a form field of the PDF (by its name). */
export function withMode<T extends MappedField | MappedSignature>(item: T, mode: 'COORDINATES' | 'ACROFORM', signature: boolean): T {
  const { page: _page, x: _x, y: _y, acroformName: _name, ...rest } = item as T & { page?: number; x?: number; y?: number; acroformName?: string };
  if (mode === 'ACROFORM') return { ...rest, mode, acroformName: '' } as unknown as T;
  return { ...rest, mode, page: 1, x: 0, y: 0, ...(signature ? DEFAULT_SIGNATURE : {}) } as unknown as T;
}

/** A form field of the PDF as the template lists it (where its widget sits is the API's to know). */
export type FormField = Pick<AcroFieldInfo, 'name' | 'type' | 'page'>;

/** The form fields of the PDF an item can go into: signature fields for signatures, the rest for values. */
export const formFieldsFor = (fields: readonly FormField[], kind: ItemKind) => fields.filter((field) => (kind === 'signatures' ? field.type === 'SIGNATURE' : field.type !== 'SIGNATURE' && field.type !== 'BUTTON'));

export const MAPPING_PROBLEM_CODES = ['DOCUMENT_FIELD_UNKNOWN', 'DOCUMENT_FIELD_TYPE_MISMATCH', 'DOCUMENT_SIGNATURE_STEP_UNKNOWN', 'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE', 'DOCUMENT_STEP_UNKNOWN', 'ACROFORM_FIELD_UNKNOWN', 'COORDINATE_OUT_OF_PAGE', 'EXPRESSION_INVALID', 'INCOMPLETE'] as const;
export type MappingProblemCode = (typeof MAPPING_PROBLEM_CODES)[number];

export interface MappingProblem {
  readonly code: MappingProblemCode;
  readonly detail: string;
  readonly item: ItemRef | undefined;
  readonly draftOnly: boolean;
}

const PATH = /^(fields|signatures)\[(\d+)\]/;
const itemOfPath = (path: string): ItemRef | undefined => {
  const match = PATH.exec(path);
  return match === null ? undefined : { kind: match[1] as ItemKind, index: Number(match[2]) };
};
const codeOf = (code: string): MappingProblemCode => MAPPING_PROBLEM_CODES.find((candidate) => candidate === code) ?? 'INCOMPLETE';
/** What a detail names: a field code, a step, a form field or a page ("page 3" → "3"). */
const detailOf = (problem: PdfProblem): string => (problem.code === 'COORDINATE_OUT_OF_PAGE' ? (problem.detail ?? '').replace(/^page /, '') : problem.code === 'DOCUMENT_FIELD_TYPE_MISMATCH' || problem.code === 'EXPRESSION_INVALID' ? '' : (problem.detail ?? ''));

/**
 * What stops the mapping, item by item: its own rules first (a value with neither field nor text, a form field not
 * chosen), then the shared checks against the version tickets run on and, apart, the draft.
 */
export function mappingProblems(mapping: TemplateMapping, template: { readonly pages: readonly PageBox[]; readonly acroformFields: readonly FormField[] }, current: WorkflowVersionDocument, draft: WorkflowVersionDocument | undefined): MappingProblem[] {
  const parsed = templateMappingSchema.safeParse(mapping);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const path = issue.path.map((part) => (typeof part === 'number' ? `[${String(part)}]` : `.${String(part)}`)).join('').replace(/^\./, '');
      return { code: /^[A-Z_]+: /.test(issue.message) ? 'EXPRESSION_INVALID' : 'INCOMPLETE', detail: '', item: itemOfPath(path), draftOnly: false };
    });
  }
  const checked = { pages: template.pages, acroformFields: template.acroformFields.map((field) => ({ ...field, rect: null })) };
  const errors = validateMapping(mapping, checked, current);
  const key = (problem: PdfProblem) => `${problem.code}|${problem.path}|${problem.detail ?? ''}`;
  const known = new Set(errors.map(key));
  const warnings = draft === undefined ? [] : validateMapping(mapping, checked, draft).filter((problem) => !known.has(key(problem)));
  const toProblem = (problem: PdfProblem, draftOnly: boolean): MappingProblem => ({ code: codeOf(problem.code), detail: detailOf(problem), item: itemOfPath(problem.path), draftOnly });
  return [...errors.map((problem) => toProblem(problem, false)), ...warnings.map((problem) => toProblem(problem, true))];
}
