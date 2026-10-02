import type { FieldDocument } from '../../workflow/document.js';
import { Decimal } from '../money/fixed-decimal.js';
import { FormulaRuntimeError, evaluateFormulaExpression, type FormulaContext, type FormulaErrorCode } from './evaluate.js';
import { compileFormula } from './parser.js';
import { buildFormulaSchema, formulaDecimals, formulaResultType } from './schema.js';
import type { CompiledFormula } from './types.js';

export interface FormulaFailure {
  readonly fieldCode: string;
  readonly reason: FormulaErrorCode | 'INVALID_FORMULA' | 'CYCLE';
  /** The formula (transitively) reads a field the current submission captured: the person can fix it, so the submission is refused. */
  readonly strict: boolean;
}

export interface ComputedFormulas {
  /** The computed values by field code: `null` for a formula that has no value or failed. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly failures: readonly FormulaFailure[];
}

/** JSON number when 15 significant digits hold it exactly, otherwise the plain decimal text. */
function storable(value: Decimal): number | string {
  return value.significantDigits() <= 15 ? Number(value.toPlainString()) : value.toPlainString();
}

function compileAll(formulaFields: readonly FieldDocument[], fields: readonly FieldDocument[]): Map<string, CompiledFormula | undefined> {
  const schema = buildFormulaSchema(fields);
  const compiled = new Map<string, CompiledFormula | undefined>();
  for (const field of formulaFields) {
    const result = compileFormula(String(field.config.expression ?? ''), schema);
    compiled.set(field.code, result.ok && result.formula.type === formulaResultType(field) ? result.formula : undefined);
  }
  return compiled;
}

function dependencyOrder(codes: ReadonlySet<string>, compiled: ReadonlyMap<string, CompiledFormula | undefined>): { order: string[]; cyclic: string[] } {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = new Set<string>();
  const visit = (code: string): void => {
    state.set(code, 'visiting');
    for (const dependency of compiled.get(code)?.references ?? []) {
      if (!codes.has(dependency)) continue;
      if (state.get(dependency) === 'visiting') {
        cyclic.add(code);
        cyclic.add(dependency);
      } else if (!state.has(dependency)) visit(dependency);
    }
    state.set(code, 'done');
    order.push(code);
  };
  for (const code of codes) if (!state.has(code)) visit(code);
  return { order, cyclic: [...cyclic] };
}

/**
 * Recomputes every FORMULA field from the values the ticket has, dependencies first. Pure and deterministic for
 * a given context. A formula that cannot produce a value stores `null` and is reported in `failures`; what to do
 * about it (refuse the submission or only warn) is the caller's policy.
 */
export function computeFormulaValues(
  fields: readonly FieldDocument[],
  current: Readonly<Record<string, unknown>>,
  context: Omit<FormulaContext, 'values'> & { readonly captured?: ReadonlySet<string> },
): ComputedFormulas {
  const formulaFields = fields.filter((field) => field.type === 'FORMULA');
  if (formulaFields.length === 0) return { values: {}, failures: [] };
  const byCode = new Map(formulaFields.map((field) => [field.code, field]));
  const compiled = compileAll(formulaFields, fields);
  const { order, cyclic } = dependencyOrder(new Set(byCode.keys()), compiled);
  const values: Record<string, unknown> = { ...current };
  const computed: Record<string, unknown> = {};
  const failures: FormulaFailure[] = [];
  // Fields a person just captured, plus the formulas that read them: a failure there is the person's to fix.
  const tainted = new Set(context.captured ?? []);
  const fail = (fieldCode: string, reason: FormulaFailure['reason']): void => {
    computed[fieldCode] = null;
    values[fieldCode] = null;
    failures.push({ fieldCode, reason, strict: tainted.has(fieldCode) });
  };
  for (const code of order) {
    const field = byCode.get(code)!;
    const formula = compiled.get(code);
    if (formula?.references.some((reference) => tainted.has(reference))) tainted.add(code);
    if (cyclic.includes(code)) fail(code, 'CYCLE');
    else if (formula === undefined) fail(code, 'INVALID_FORMULA');
    else {
      try {
        const result = evaluateFormulaExpression(formula.expression, { today: context.today, ...(context.isBusinessDay === undefined ? {} : { isBusinessDay: context.isBusinessDay }), values });
        const stored = result instanceof Decimal ? storable(result.round(formulaDecimals(field))) : result;
        computed[code] = stored;
        values[code] = stored;
      } catch (error) {
        if (!(error instanceof FormulaRuntimeError)) throw error;
        fail(code, error.code);
      }
    }
  }
  return { values: computed, failures };
}
