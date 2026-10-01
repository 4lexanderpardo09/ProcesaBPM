import { NotImplementedError, type FieldValueIssue } from '../../errors/domain-error.js';
import type { FieldDocument } from '../../workflow/document.js';
import { isBlankValue, normalizeTable, normalizeValue } from './normalize-value.js';
import type { CapturedValues, ReferenceToVerify, ValidationContext } from './types.js';

/** Fields whose value the engine computes: a client value is ignored, never stored. */
export const COMPUTED_FIELD_TYPES: ReadonlySet<FieldDocument['type']> = new Set(['FORMULA', 'CALCULATOR']);

export interface CaptureInput {
  /** The fields this submission may fill (see `captureFieldsFor`). */
  readonly fields: readonly FieldDocument[];
  readonly input: Readonly<Record<string, unknown>>;
  /** Values the ticket already has: they satisfy `required`. */
  readonly existing: Readonly<Record<string, unknown>>;
  readonly context: ValidationContext;
}

/** The fields captured when a ticket is created (CREATION or BOTH of the chosen START) or when a step is answered (STEP or BOTH). */
export function captureFieldsFor(fields: readonly FieldDocument[], stage: 'CREATION' | 'STEP', stepId: string): readonly FieldDocument[] {
  const accepted = stage === 'CREATION' ? ['CREATION', 'BOTH'] : ['STEP', 'BOTH'];
  return fields.filter((field) => field.stepId === stepId && accepted.includes(field.capture));
}

/**
 * Validates and normalizes what a person submitted. Pure: references to the tenant's data (sites, users,
 * preset records) come back in `references` for the server to verify. Never throws for bad values; a
 * `NotImplementedError` is only raised for file fields, which need the files module.
 */
export function validateCapturedValues({ fields, input, existing, context }: CaptureInput): CapturedValues {
  const issues: FieldValueIssue[] = [];
  const references: ReferenceToVerify[] = [];
  const values: Record<string, unknown> = {};
  const byCode = new Map(fields.map((field) => [field.code, field]));

  for (const code of Object.keys(input)) {
    if (!byCode.has(code)) issues.push({ code: 'UNKNOWN_FIELD', fieldCode: code });
  }

  for (const field of fields) {
    if (COMPUTED_FIELD_TYPES.has(field.type)) continue;
    const raw = input[field.code];
    if (isBlankValue(raw)) {
      // A read-only field is never typed by the person, so it cannot be demanded of them either.
      if (field.isRequired && !field.isReadOnly && isBlankValue(existing[field.code])) issues.push({ code: 'REQUIRED', fieldCode: field.code });
      continue;
    }
    if (field.isReadOnly) {
      issues.push({ code: 'NOT_EDITABLE', fieldCode: field.code });
      continue;
    }
    if (field.type === 'FILE') throw new NotImplementedError('File fields');
    if (field.type === 'TABLE') {
      const table = normalizeTable(raw, field.config, context);
      if (table.ok) values[field.code] = table.value;
      else if (table.cells.length === 0) issues.push({ code: table.code, fieldCode: field.code });
      else for (const cell of table.cells) issues.push({ code: cell.code, fieldCode: field.code, row: cell.rowIndex, column: cell.column });
      continue;
    }
    const result = normalizeValue(field.type, field.config, field.dataSource, raw, context);
    if (result.ok) {
      values[field.code] = result.value;
      for (const reference of result.references) references.push({ ...reference, fieldCode: field.code });
    } else issues.push({ code: result.code, fieldCode: field.code });
  }
  return { values, issues, references };
}
