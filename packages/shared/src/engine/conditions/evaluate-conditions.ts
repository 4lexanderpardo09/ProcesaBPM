import { InvalidConditionError } from '../../errors/domain-error.js';
import { CONDITION_OPERATORS, type Condition, type ConditionContext, type ConditionOperator } from './types.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Comparator = (actual: unknown, expected: unknown) => boolean;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toText(value: unknown): string {
  return String(value).trim().toLowerCase();
}

/** Accepts `YYYY-MM-DD` (compared as a calendar day) and full ISO date-times (compared as instants). */
function toTimestamp(value: unknown): number | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime();
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!DATE_ONLY_PATTERN.test(text) && !text.includes('T')) return undefined;
  const parsed = Date.parse(DATE_ONLY_PATTERN.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function looselyEqual(actual: unknown, expected: unknown): boolean {
  const actualNumber = toNumber(actual);
  const expectedNumber = toNumber(expected);
  if (actualNumber !== undefined && expectedNumber !== undefined) return actualNumber === expectedNumber;
  return toText(actual) === toText(expected);
}

function compareNumbers(test: (actual: number, expected: number) => boolean): Comparator {
  return (actual, expected) => {
    const actualNumber = toNumber(actual);
    const expectedNumber = toNumber(expected);
    return actualNumber !== undefined && expectedNumber !== undefined && test(actualNumber, expectedNumber);
  };
}

function compareDates(test: (actual: number, expected: number) => boolean): Comparator {
  return (actual, expected) => {
    const actualTime = toTimestamp(actual);
    const expectedTime = toTimestamp(expected);
    return actualTime !== undefined && expectedTime !== undefined && test(actualTime, expectedTime);
  };
}

const COMPARATORS: Readonly<Record<ConditionOperator, Comparator>> = {
  equals: looselyEqual,
  not_equals: (actual, expected) => !looselyEqual(actual, expected),
  starts_with: (actual, expected) => toText(actual).startsWith(toText(expected)),
  contains: (actual, expected) => toText(actual).includes(toText(expected)),
  in_list: (actual, expected) => Array.isArray(expected) && expected.some((item) => looselyEqual(actual, item)),
  gt: compareNumbers((a, b) => a > b),
  gte: compareNumbers((a, b) => a >= b),
  lt: compareNumbers((a, b) => a < b),
  lte: compareNumbers((a, b) => a <= b),
  date_before: compareDates((a, b) => a < b),
  date_after: compareDates((a, b) => a > b),
  date_on_or_before: compareDates((a, b) => a <= b),
  date_on_or_after: compareDates((a, b) => a >= b),
};

function assertValidCondition(condition: Condition): void {
  if (typeof condition.field !== 'string' || condition.field === '') {
    throw new InvalidConditionError('A condition needs a field code');
  }
  if (!CONDITION_OPERATORS.includes(condition.op)) {
    throw new InvalidConditionError(`Unknown operator "${String(condition.op)}" on field "${condition.field}"`);
  }
  if (condition.op === 'in_list' && !Array.isArray(condition.value)) {
    throw new InvalidConditionError(`Operator in_list on field "${condition.field}" needs a list value`);
  }
}

/**
 * Numeric and currency values are stored normalized as JSON numbers: a text such as `1.500.000`
 * (thousands separators) is not read as a number; the server normalizes it when it saves the value.
 * In dates, when one side is `YYYY-MM-DD` and the other has a time, the day is taken as midnight UTC.
 *
 * A missing or blank field only satisfies `not_equals`; every other operator is false,
 * so an unanswered field never routes a ticket through a branch by accident.
 */
export function evaluateCondition(condition: Condition, context: ConditionContext): boolean {
  assertValidCondition(condition);
  const actual = context[condition.field];
  if (isBlank(actual)) return condition.op === 'not_equals';
  return COMPARATORS[condition.op](actual, condition.value);
}

/** All conditions must hold (AND). An empty list is satisfied. */
export function evaluateConditions(conditions: readonly Condition[], context: ConditionContext): boolean {
  return conditions.every((condition) => evaluateCondition(condition, context));
}
