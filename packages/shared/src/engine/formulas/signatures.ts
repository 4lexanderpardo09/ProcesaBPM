import type { FormulaType } from './types.js';

/** `SCALAR` accepts a number, text or date; `NUMBERS` accepts numbers or one list (`SUM(ITEMS.AMOUNT)`). */
export type ParameterType = Exclude<FormulaType, 'LIST'> | 'SCALAR' | 'NUMBERS' | 'LIST';

export interface Signature {
  readonly parameters: readonly ParameterType[];
  /** How many trailing parameters may be left out. */
  readonly optional?: number;
  /** Type of any extra arguments after `parameters`. */
  readonly rest?: ParameterType;
  readonly returns: Exclude<FormulaType, 'LIST'>;
}

/** Function names are English and upper case; `IF` and `IFERROR` have their own typing and lazy evaluation. */
export const SIGNATURES: Readonly<Record<string, Signature>> = {
  ROUND: { parameters: ['NUMBER', 'NUMBER'], optional: 1, returns: 'NUMBER' },
  ROUNDDOWN: { parameters: ['NUMBER', 'NUMBER'], optional: 1, returns: 'NUMBER' },
  ABS: { parameters: ['NUMBER'], returns: 'NUMBER' },
  MIN: { parameters: ['NUMBERS'], rest: 'NUMBER', returns: 'NUMBER' },
  MAX: { parameters: ['NUMBERS'], rest: 'NUMBER', returns: 'NUMBER' },
  SUM: { parameters: ['LIST'], returns: 'NUMBER' },
  AVG: { parameters: ['LIST'], returns: 'NUMBER' },
  COUNT: { parameters: ['LIST'], returns: 'NUMBER' },
  AND: { parameters: ['BOOLEAN', 'BOOLEAN'], rest: 'BOOLEAN', returns: 'BOOLEAN' },
  OR: { parameters: ['BOOLEAN', 'BOOLEAN'], rest: 'BOOLEAN', returns: 'BOOLEAN' },
  NOT: { parameters: ['BOOLEAN'], returns: 'BOOLEAN' },
  ISBLANK: { parameters: ['SCALAR'], returns: 'BOOLEAN' },
  CONCAT: { parameters: ['SCALAR'], rest: 'SCALAR', returns: 'TEXT' },
  UPPER: { parameters: ['TEXT'], returns: 'TEXT' },
  LOWER: { parameters: ['TEXT'], returns: 'TEXT' },
  TRIM: { parameters: ['TEXT'], returns: 'TEXT' },
  LEFT: { parameters: ['TEXT', 'NUMBER'], returns: 'TEXT' },
  LEN: { parameters: ['TEXT'], returns: 'NUMBER' },
  TODAY: { parameters: [], returns: 'DATE' },
  ADD_DAYS: { parameters: ['DATE', 'NUMBER'], returns: 'DATE' },
  ADD_BUSINESS_DAYS: { parameters: ['DATE', 'NUMBER'], returns: 'DATE' },
  DAYS_BETWEEN: { parameters: ['DATE', 'DATE'], returns: 'NUMBER' },
  YEAR: { parameters: ['DATE'], returns: 'NUMBER' },
  MONTH: { parameters: ['DATE'], returns: 'NUMBER' },
  DAY: { parameters: ['DATE'], returns: 'NUMBER' },
};

export const CONTROL_FUNCTIONS: ReadonlySet<string> = new Set(['IF', 'IFERROR']);
