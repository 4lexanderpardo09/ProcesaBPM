import type { FieldDocument } from '../../workflow/document.js';
import type { FormulaFieldShape, FormulaSchema, FormulaType } from './types.js';

type ScalarType = Exclude<FormulaType, 'LIST' | 'BOOLEAN'>;

const FIELD_TYPE_TO_FORMULA: Readonly<Partial<Record<FieldDocument['type'], ScalarType>>> = {
  NUMBER: 'NUMBER',
  CURRENCY: 'NUMBER',
  DAYS: 'NUMBER',
  CALCULATOR: 'NUMBER',
  TEXT: 'TEXT',
  TEXTAREA: 'TEXT',
  SELECT: 'TEXT',
  DATE: 'DATE',
};

const COLUMN_TYPE_TO_FORMULA: Readonly<Record<string, ScalarType>> = { TEXT: 'TEXT', SELECT: 'TEXT', NUMBER: 'NUMBER', CURRENCY: 'NUMBER', DATE: 'DATE' };

/** What a FORMULA field produces, from its `resultType`. */
export function formulaResultType(field: FieldDocument): ScalarType {
  const declared = field.config.resultType;
  return declared === 'DATE' ? 'DATE' : declared === 'TEXT' ? 'TEXT' : 'NUMBER';
}

/** Decimals a numeric FORMULA result is rounded to: money has two, a plain number defaults to two as well. */
export function formulaDecimals(field: FieldDocument): number {
  if (field.config.resultType === 'CURRENCY') return 2;
  return typeof field.config.decimals === 'number' ? field.config.decimals : 2;
}

function shapeOf(field: FieldDocument): FormulaFieldShape | undefined {
  if (field.type === 'FORMULA') return { kind: 'value', type: formulaResultType(field) };
  if (field.type === 'TABLE') {
    const columns = new Map<string, ScalarType>();
    const declared = Array.isArray(field.config.columns) ? (field.config.columns as { code?: unknown; type?: unknown }[]) : [];
    for (const column of declared) {
      const type = typeof column.type === 'string' ? COLUMN_TYPE_TO_FORMULA[column.type] : undefined;
      if (typeof column.code === 'string' && type !== undefined) columns.set(column.code, type);
    }
    return { kind: 'table', columns };
  }
  const type = FIELD_TYPE_TO_FORMULA[field.type];
  return type === undefined ? undefined : { kind: 'value', type };
}

/** The fields a formula may read. Field types without a formula type (files, users, sites, multi-selects, date-times) are left out. */
export function buildFormulaSchema(fields: readonly FieldDocument[]): FormulaSchema {
  const entries = new Map<string, FormulaFieldShape>();
  for (const field of fields) {
    const shape = shapeOf(field);
    if (shape !== undefined) entries.set(field.code, shape);
  }
  return { fields: entries };
}
