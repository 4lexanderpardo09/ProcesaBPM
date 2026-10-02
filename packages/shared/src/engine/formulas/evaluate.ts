import { Decimal, DecimalError } from '../money/fixed-decimal.js';
import { addDaysToLocalDate } from '../business-time/time-zone.js';
import { FORMULA_LIMITS, type BinaryOperator, type Expression } from './types.js';

export type FormulaErrorCode = 'DIVISION_BY_ZERO' | 'NUMBER_OVERFLOW' | 'INVALID_VALUE' | 'INVALID_DATE' | 'TEXT_TOO_LONG' | 'ARGUMENT_OUT_OF_RANGE';

/** A formula that cannot produce a value for these inputs (division by zero, a date out of range…). */
export class FormulaRuntimeError extends Error {
  override readonly name = 'FormulaRuntimeError';
  constructor(readonly code: FormulaErrorCode) {
    super(code);
  }
}

/** `null` is "no value": it propagates through operators and functions (except `ISBLANK` and `IFERROR`). */
export type FormulaValue = Decimal | string | boolean | null;
type Runtime = FormulaValue | readonly (Decimal | null)[];

export interface FormulaContext {
  /** Values of the ticket by field code: JSON numbers or decimal strings, `YYYY-MM-DD`, text, and tables as arrays of row objects. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Today in the company time zone, `YYYY-MM-DD`. */
  readonly today: string;
  /** Whether a `YYYY-MM-DD` date is a working day of the company calendar; without it Monday to Friday count. */
  readonly isBusinessDay?: (date: string) => boolean;
}

/** Working days one evaluation may scan in total: many `ADD_BUSINESS_DAYS` calls cannot add up to a stall. */
const SCANNED_DAYS_BUDGET = 30_000;
type RunContext = FormulaContext & { readonly budget: { remaining: number } };

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDate(value: string): string {
  const match = DATE_TEXT.exec(value);
  if (match === null) throw new FormulaRuntimeError('INVALID_DATE');
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day || year < 1900 || year > 2200) {
    throw new FormulaRuntimeError('INVALID_DATE');
  }
  return value;
}

const dateToDays = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

function toInteger(value: Decimal, max = 100_000): number {
  const whole = Number(value.round(0, 'DOWN').toPlainString());
  if (Math.abs(whole) > max) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
  return whole;
}

function guarded<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof DecimalError) throw new FormulaRuntimeError(error.reason === 'INVALID_NUMBER' ? 'INVALID_VALUE' : error.reason);
    throw error;
  }
}

function readNumber(raw: unknown): Decimal | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new FormulaRuntimeError('INVALID_VALUE');
  return guarded(() => Decimal.parse(raw));
}

function readScalar(raw: unknown, type: 'NUMBER' | 'TEXT' | 'DATE'): Decimal | string | null {
  if (type === 'NUMBER') return readNumber(raw);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new FormulaRuntimeError('INVALID_VALUE');
  return type === 'DATE' ? assertDate(raw) : raw;
}

function readColumn(values: FormulaContext['values'], table: string, column: string, type: 'NUMBER' | 'TEXT' | 'DATE'): (Decimal | null)[] {
  const rows = values[table];
  if (rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new FormulaRuntimeError('INVALID_VALUE');
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) throw new FormulaRuntimeError('INVALID_VALUE');
    return readScalar((row as Record<string, unknown>)[column], type) as Decimal | null;
  });
}

const present = (list: readonly (Decimal | null)[]): Decimal[] => {
  const entries = list.filter((entry) => entry !== null);
  if (!entries.every((entry) => entry instanceof Decimal)) throw new FormulaRuntimeError('INVALID_VALUE');
  return entries;
};

function compareValues(left: Exclude<FormulaValue, null>, right: Exclude<FormulaValue, null>): number {
  if (left instanceof Decimal) return left.compare(right as Decimal);
  return left < right ? -1 : left > right ? 1 : 0;
}

function binary(operator: BinaryOperator, left: FormulaValue, right: FormulaValue): FormulaValue {
  if (operator === '&&') return left === true && right === true;
  if (operator === '||') return left === true || right === true;
  if (left === null || right === null) return null;
  switch (operator) {
    case '=':
      return compareValues(left, right) === 0;
    case '!=':
      return compareValues(left, right) !== 0;
    case '<':
      return compareValues(left, right) < 0;
    case '<=':
      return compareValues(left, right) <= 0;
    case '>':
      return compareValues(left, right) > 0;
    case '>=':
      return compareValues(left, right) >= 0;
  }
  const [a, b] = [left as Decimal, right as Decimal];
  return guarded(() => {
    switch (operator) {
      case '+':
        return a.add(b);
      case '-':
        return a.sub(b);
      case '*':
        return a.mul(b);
      case '/':
        return a.div(b);
      default:
        return a.rem(b);
    }
  });
}

function textOf(value: Decimal | string): string {
  return value instanceof Decimal ? value.toPlainString() : value;
}

function boundedText(text: string): string {
  if (text.length > FORMULA_LIMITS.textLength) throw new FormulaRuntimeError('TEXT_TOO_LONG');
  return text;
}

function addBusinessDays(start: string, count: number, context: RunContext): string {
  if (Math.abs(count) > FORMULA_LIMITS.maxBusinessDays) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
  context.budget.remaining -= Math.abs(count) * 3 + 1;
  if (context.budget.remaining < 0) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
  const isBusinessDay = context.isBusinessDay ?? ((date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
  const step = count < 0 ? -1 : 1;
  let date = start;
  let remaining = Math.abs(count);
  for (let scanned = 0; remaining > 0; scanned += 1) {
    if (scanned > FORMULA_LIMITS.maxBusinessDays * 3) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
    date = addDaysToLocalDate(date, step);
    if (isBusinessDay(date)) remaining -= 1;
  }
  return assertDate(date);
}

function callFunction(name: string, args: readonly Runtime[], context: RunContext): Runtime {
  const list = (index: number): readonly (Decimal | null)[] => args[index] as readonly (Decimal | null)[];
  const scalar = (index: number): FormulaValue => args[index] as FormulaValue;
  switch (name) {
    case 'SUM':
      return guarded(() => present(list(0)).reduce((total, entry) => total.add(entry), Decimal.ZERO));
    case 'AVG': {
      const entries = present(list(0));
      return entries.length === 0 ? null : guarded(() => entries.reduce((total, entry) => total.add(entry), Decimal.ZERO).div(Decimal.fromInteger(entries.length)));
    }
    case 'COUNT':
      return Decimal.fromInteger(present(list(0)).length);
    case 'MIN':
    case 'MAX': {
      const entries = args.flatMap((arg) => (Array.isArray(arg) ? present(arg) : arg instanceof Decimal ? [arg] : []));
      if (entries.length === 0 || args.some((arg) => arg === null)) return null;
      return entries.reduce((best, entry) => ((name === 'MIN' ? entry.compare(best) < 0 : entry.compare(best) > 0) ? entry : best));
    }
    case 'AND':
      return args.every((arg) => arg === true);
    case 'OR':
      return args.some((arg) => arg === true);
    case 'ISBLANK':
      return scalar(0) === null;
    case 'TODAY':
      return assertDate(context.today);
    case 'CONCAT':
      return boundedText(args.map((arg) => (arg === null ? '' : textOf(arg as Decimal | string))).join(''));
  }
  if (args.some((arg) => arg === null)) return null;
  const first = scalar(0);
  switch (name) {
    case 'ROUND':
    case 'ROUNDDOWN': {
      const places = args.length > 1 ? toInteger(scalar(1) as Decimal, 12) : 0;
      if (places < 0) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
      return (first as Decimal).round(places, name === 'ROUND' ? 'HALF_UP' : 'DOWN');
    }
    case 'ABS':
      return (first as Decimal).abs();
    case 'NOT':
      return first !== true;
    case 'UPPER':
      return (first as string).toUpperCase();
    case 'LOWER':
      return (first as string).toLowerCase();
    case 'TRIM':
      return (first as string).trim();
    case 'LEFT':
      return (first as string).slice(0, Math.max(0, toInteger(scalar(1) as Decimal, 1000)));
    case 'LEN':
      return Decimal.fromInteger((first as string).length);
    case 'ADD_DAYS':
      return assertDate(addDaysToLocalDate(first as string, toInteger(scalar(1) as Decimal)));
    case 'ADD_BUSINESS_DAYS':
      return addBusinessDays(first as string, toInteger(scalar(1) as Decimal, FORMULA_LIMITS.maxBusinessDays), context);
    case 'DAYS_BETWEEN':
      return Decimal.fromInteger(dateToDays(scalar(1) as string) - dateToDays(first as string));
    case 'YEAR':
      return Decimal.fromInteger(Number((first as string).slice(0, 4)));
    case 'MONTH':
      return Decimal.fromInteger(Number((first as string).slice(5, 7)));
    case 'DAY':
      return Decimal.fromInteger(Number((first as string).slice(8, 10)));
  }
  throw new FormulaRuntimeError('INVALID_VALUE');
}

const boundedResult = (value: Runtime): Runtime => (typeof value === 'string' ? boundedText(value) : value);

function run(node: Expression, context: RunContext): Runtime {
  switch (node.kind) {
    case 'number':
    case 'text':
    case 'boolean':
      return node.value;
    case 'field':
      return readScalar(context.values[node.code], node.type);
    case 'column':
      return readColumn(context.values, node.table, node.column, node.type);
    case 'unary': {
      const operand = run(node.operand, context) as FormulaValue;
      if (operand === null) return null;
      return node.operator === '-' ? (operand as Decimal).negate() : operand !== true;
    }
    case 'binary':
      return binary(node.operator, run(node.left, context) as FormulaValue, run(node.right, context) as FormulaValue);
    case 'call':
      if (node.name === 'IF') return run(node.args[0]!, context) === true ? run(node.args[1]!, context) : run(node.args[2]!, context);
      if (node.name === 'IFERROR') {
        try {
          return guarded(() => run(node.args[0]!, context));
        } catch (error) {
          if (error instanceof FormulaRuntimeError) return run(node.args[1]!, context);
          throw error;
        }
      }
      return boundedResult(
        callFunction(
          node.name,
          node.args.map((arg) => run(arg, context)),
          context,
        ),
      );
  }
}

/** Evaluates a compiled formula. Throws `FormulaRuntimeError` when no value can be produced; there is no `eval` and no host access. */
export function evaluateFormulaExpression(expression: Expression, context: FormulaContext): FormulaValue {
  return guarded(() => run(expression, { ...context, budget: { remaining: SCANNED_DAYS_BUDGET } }) as FormulaValue);
}
