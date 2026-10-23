import { Decimal } from '../money/fixed-decimal.js';
import { evaluateFormulaExpression, FormulaRuntimeError } from '../formulas/evaluate.js';
import { compileFormula } from '../formulas/parser.js';
import type { CompiledFormula, FormulaFieldShape, FormulaSchema } from '../formulas/types.js';
import type { TableColumn } from './normalize-value.js';

const COLUMN_TYPES: Readonly<Record<string, 'NUMBER' | 'TEXT' | 'DATE'>> = { NUMBER: 'NUMBER', CURRENCY: 'NUMBER', TEXT: 'TEXT', SELECT: 'TEXT', DATE: 'DATE' };

/** What a row formula may read: the other columns of the same row that people fill (not other formula columns). */
export function rowFormulaSchema(columns: readonly TableColumn[]): FormulaSchema {
  const fields = new Map<string, FormulaFieldShape>();
  for (const column of columns) {
    const type = COLUMN_TYPES[column.type];
    if (type !== undefined) fields.set(column.code, { kind: 'value', type });
  }
  return { fields };
}

export interface RowFormula {
  readonly code: string;
  readonly decimals: number;
  /** `undefined` when the expression does not compile: the cell stays empty (the workflow check says why). */
  readonly compiled: CompiledFormula | undefined;
}

/** The formula columns of a table, compiled once for all its rows. */
export function compileRowFormulas(columns: readonly TableColumn[]): RowFormula[] {
  const schema = rowFormulaSchema(columns);
  return columns
    .filter((column) => column.type === 'FORMULA')
    .map((column) => {
      const result = compileFormula(column.expression ?? '', schema);
      return { code: column.code, decimals: column.decimals ?? 2, compiled: result.ok && result.formula.type === 'NUMBER' ? result.formula : undefined };
    });
}

/** JSON number when 15 significant digits hold it exactly, otherwise the plain decimal text (as FORMULA fields store it). */
const storable = (value: Decimal): number | string => (value.significantDigits() <= 15 ? Number(value.toPlainString()) : value.toPlainString());

/**
 * The row with each formula column computed from its other cells. A formula that cannot be computed for this row (an
 * empty cell, a division by zero) leaves the cell empty instead of failing the whole table.
 */
export function withRowFormulas(row: Readonly<Record<string, unknown>>, formulas: readonly RowFormula[], today: string): Record<string, unknown> {
  if (formulas.length === 0) return { ...row };
  const computed: Record<string, unknown> = { ...row };
  for (const formula of formulas) {
    delete computed[formula.code];
    if (formula.compiled === undefined) continue;
    try {
      const value = evaluateFormulaExpression(formula.compiled.expression, { values: row, today });
      if (value instanceof Decimal) computed[formula.code] = storable(value.round(formula.decimals));
    } catch (error) {
      if (!(error instanceof FormulaRuntimeError)) throw error;
    }
  }
  return computed;
}
