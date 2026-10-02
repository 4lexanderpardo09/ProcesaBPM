import { findCalculator } from '../../calculators/registry.js';
import type { FieldDocument } from '../../workflow/document.js';
import { Decimal } from '../money/fixed-decimal.js';
import { FormulaRuntimeError, evaluateFormulaExpression, type FormulaContext, type FormulaErrorCode } from './evaluate.js';
import { compileFormula } from './parser.js';
import { buildFormulaSchema, formulaDecimals, formulaResultType } from './schema.js';
import type { CompiledFormula } from './types.js';

export interface FormulaFailure {
  readonly fieldCode: string;
  readonly reason: FormulaErrorCode | 'INVALID_FORMULA' | 'CYCLE' | 'CALCULATOR_UNKNOWN' | 'CALCULATOR_NOT_CONFIGURED';
  /** The field (transitively) reads a field the current submission captured: the person can fix it, so the submission is refused. */
  readonly strict: boolean;
}

export interface ComputedFormulas {
  /** The computed values by field code: `null` for a field that has no value or failed. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly failures: readonly FormulaFailure[];
}

export interface ComputeContext extends Omit<FormulaContext, 'values'> {
  /** Codes the current submission captured; failures that depend on them are `strict`. */
  readonly captured?: ReadonlySet<string>;
  /** Time zone of the company (calculators work with local days). */
  readonly timeZone?: string;
  /** Per-tenant configuration of the calculators that are switched on, by calculator code. */
  readonly calculatorConfigs?: ReadonlyMap<string, Record<string, unknown>>;
}

/** JSON number when 15 significant digits hold it exactly, otherwise the plain decimal text. */
export function storableNumber(value: Decimal): number | string {
  return value.significantDigits() <= 15 ? Number(value.toPlainString()) : value.toPlainString();
}

type Computation = { readonly references: readonly string[]; run(values: Record<string, unknown>): unknown } | 'INVALID';

function formulaComputation(field: FieldDocument, compiled: CompiledFormula | undefined, context: ComputeContext): Computation {
  if (compiled === undefined) return 'INVALID';
  return {
    references: compiled.references,
    run(values) {
      const result = evaluateFormulaExpression(compiled.expression, { today: context.today, ...(context.isBusinessDay === undefined ? {} : { isBusinessDay: context.isBusinessDay }), values });
      return result instanceof Decimal ? storableNumber(result.round(formulaDecimals(field))) : result;
    },
  };
}

function calculatorComputation(field: FieldDocument, context: ComputeContext): Computation | FormulaFailure['reason'] {
  const calculator = findCalculator(String(field.config.calculatorCode ?? ''));
  if (calculator === undefined) return 'CALCULATOR_UNKNOWN';
  const config = context.calculatorConfigs?.get(calculator.code);
  if (config === undefined) return 'CALCULATOR_NOT_CONFIGURED';
  const inputs = (field.config.inputs ?? {}) as Record<string, string>;
  return {
    references: Object.values(inputs),
    run(values) {
      const named = Object.fromEntries(Object.entries(inputs).map(([name, code]) => [name, values[code]]));
      const result = calculator.compute(named, config, { timeZone: context.timeZone ?? 'UTC' });
      return result === null ? null : storableNumber(result.round(calculator.output === 'CURRENCY' ? 2 : 6));
    },
  };
}

function dependencyOrder(codes: ReadonlySet<string>, references: ReadonlyMap<string, readonly string[]>): { order: string[]; cyclic: Set<string> } {
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = new Set<string>();
  const path: string[] = [];
  const visit = (code: string): void => {
    state.set(code, 'visiting');
    path.push(code);
    for (const dependency of references.get(code) ?? []) {
      if (!codes.has(dependency)) continue;
      if (state.get(dependency) === 'visiting') for (const member of path.slice(path.indexOf(dependency))) cyclic.add(member);
      else if (!state.has(dependency)) visit(dependency);
    }
    path.pop();
    state.set(code, 'done');
    order.push(code);
  };
  for (const code of codes) if (!state.has(code)) visit(code);
  return { order, cyclic };
}

/**
 * Recomputes every FORMULA and CALCULATOR field from the values the ticket has, dependencies first. Pure and
 * deterministic for a given context. A field that cannot produce a value stores `null` and is reported in
 * `failures`; what to do about it (refuse the submission or only record it) is the caller's policy.
 */
export function computeFieldValues(fields: readonly FieldDocument[], current: Readonly<Record<string, unknown>>, context: ComputeContext): ComputedFormulas {
  const computedFields = fields.filter((field) => field.type === 'FORMULA' || field.type === 'CALCULATOR');
  if (computedFields.length === 0) return { values: {}, failures: [] };
  const schema = buildFormulaSchema(fields);
  const byCode = new Map(computedFields.map((field) => [field.code, field]));
  const computations = new Map<string, Computation | FormulaFailure['reason']>();
  for (const field of computedFields) {
    if (field.type === 'CALCULATOR') computations.set(field.code, calculatorComputation(field, context));
    else {
      const result = compileFormula(String(field.config.expression ?? ''), schema);
      computations.set(field.code, formulaComputation(field, result.ok && result.formula.type === formulaResultType(field) ? result.formula : undefined, context));
    }
  }
  const references = new Map([...computations].map(([code, computation]) => [code, typeof computation === 'object' ? computation.references : []]));
  const { order, cyclic } = dependencyOrder(new Set(byCode.keys()), references);

  const values: Record<string, unknown> = { ...current };
  const computed: Record<string, unknown> = {};
  const failures: FormulaFailure[] = [];
  // Fields a person just captured, plus the computed fields that read them: a failure there is the person's to fix.
  const tainted = new Set(context.captured ?? []);
  const fail = (fieldCode: string, reason: FormulaFailure['reason']): void => {
    computed[fieldCode] = null;
    values[fieldCode] = null;
    failures.push({ fieldCode, reason, strict: tainted.has(fieldCode) });
  };
  for (const code of order) {
    const computation = computations.get(code)!;
    if (typeof computation === 'object' && computation.references.some((reference) => tainted.has(reference))) tainted.add(code);
    if (cyclic.has(code)) fail(code, 'CYCLE');
    else if (computation === 'INVALID') fail(code, 'INVALID_FORMULA');
    else if (typeof computation === 'string') fail(code, computation);
    else {
      try {
        const stored = computation.run(values);
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
