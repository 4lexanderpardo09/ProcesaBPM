import type { Decimal } from '../money/fixed-decimal.js';

/** What a formula expression can produce. `LIST` only exists as the argument of an aggregate (`SUM(ITEMS.AMOUNT)`). */
export type FormulaType = 'NUMBER' | 'TEXT' | 'DATE' | 'BOOLEAN' | 'LIST';

export type FormulaIssueCode =
  | 'TOO_LONG'
  | 'TOO_DEEP'
  | 'TOO_COMPLEX'
  | 'SYNTAX'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_COLUMN'
  | 'UNSUPPORTED_FIELD'
  | 'UNKNOWN_FUNCTION'
  | 'WRONG_ARGUMENT_COUNT'
  | 'TYPE_MISMATCH'
  | 'LIST_OUTSIDE_AGGREGATE';

export interface FormulaIssue {
  readonly code: FormulaIssueCode;
  /** Zero-based offset in the source text. */
  readonly position: number;
  readonly detail?: string;
}

export type Expression =
  | { readonly kind: 'number'; readonly value: Decimal }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'field'; readonly code: string; readonly type: Exclude<FormulaType, 'LIST' | 'BOOLEAN'> }
  | { readonly kind: 'column'; readonly table: string; readonly column: string; readonly type: Exclude<FormulaType, 'LIST' | 'BOOLEAN'> }
  | { readonly kind: 'unary'; readonly operator: '-' | '!'; readonly operand: Expression }
  | { readonly kind: 'binary'; readonly operator: BinaryOperator; readonly left: Expression; readonly right: Expression }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Expression[] };

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

/** A formula that passed every static check: its result type and the fields it reads. */
export interface CompiledFormula {
  readonly source: string;
  readonly expression: Expression;
  readonly type: Exclude<FormulaType, 'LIST'>;
  /** Codes of the fields (tables included) the formula reads: the dependency edges of the recomputation order. */
  readonly references: readonly string[];
}

export type CompileResult = { readonly ok: true; readonly formula: CompiledFormula } | { readonly ok: false; readonly issues: readonly FormulaIssue[] };

/** The shape of the form a formula is written against. */
export interface FormulaSchema {
  readonly fields: ReadonlyMap<string, FormulaFieldShape>;
}
export type FormulaFieldShape =
  | { readonly kind: 'value'; readonly type: Exclude<FormulaType, 'LIST' | 'BOOLEAN'> }
  | { readonly kind: 'table'; readonly columns: ReadonlyMap<string, Exclude<FormulaType, 'LIST' | 'BOOLEAN'>> };

export const FORMULA_LIMITS = {
  sourceLength: 2000,
  depth: 20,
  nodes: 400,
  textLength: 1000,
  maxBusinessDays: 3660,
} as const;
