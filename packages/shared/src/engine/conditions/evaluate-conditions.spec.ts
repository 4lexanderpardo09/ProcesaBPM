import { describe, expect, it } from 'vitest';
import { InvalidConditionError } from '../../errors/domain-error.js';
import { evaluateCondition, evaluateConditions } from './evaluate-conditions.js';
import type { Condition, ConditionOperator, ConditionValue } from './types.js';

type Row = [operator: ConditionOperator, actual: unknown, expected: ConditionValue, result: boolean];

const rows: Row[] = [
  ['equals', 'Approved', 'approved', true],
  ['equals', '  approved ', 'APPROVED', true],
  ['equals', 'approved', 'rejected', false],
  ['equals', 100, '100', true],
  ['equals', '100.0', 100, true],
  ['equals', true, 'true', true],
  ['not_equals', 'a', 'b', true],
  ['not_equals', 'a', 'A', false],
  ['not_equals', 5, 5, false],
  ['starts_with', 'Bogotá D.C.', 'bogo', true],
  ['starts_with', 'Bogotá D.C.', 'D.C.', false],
  ['contains', 'Purchase of laptops', 'LAPTOP', true],
  ['contains', 'Purchase of laptops', 'phone', false],
  ['in_list', 'B', ['a', 'b', 'c'], true],
  ['in_list', 2, ['1', '2'], true],
  ['in_list', 'z', ['a', 'b'], false],
  ['in_list', 'a', [], false],
  ['gt', 10, 5, true],
  ['gt', 5, 5, false],
  ['gt', '1500000', 1000000, true],
  ['gt', 'abc', 1, false],
  ['gte', 5, 5, true],
  ['gte', 4, 5, false],
  ['lt', 4, 5, true],
  ['lt', 5, 5, false],
  ['lte', 5, 5, true],
  ['lte', 6, 5, false],
  ['date_before', '2026-01-10', '2026-01-11', true],
  ['date_before', '2026-01-11', '2026-01-11', false],
  ['date_after', '2026-02-01', '2026-01-31', true],
  ['date_after', '2026-01-31', '2026-01-31', false],
  ['date_on_or_before', '2026-01-11', '2026-01-11', true],
  ['date_on_or_before', '2026-01-12', '2026-01-11', false],
  ['date_on_or_after', '2026-01-11', '2026-01-11', true],
  ['date_on_or_after', '2026-01-10', '2026-01-11', false],
  ['date_before', '2026-01-10T10:00:00Z', '2026-01-10T11:00:00Z', true],
  ['date_after', '2026-01-10T12:00:00-05:00', '2026-01-10T11:00:00Z', true],
  ['date_before', 'not a date', '2026-01-11', false],
  ['date_before', '2026-01-10', 'not a date', false],
];

describe('evaluateCondition', () => {
  it.each(rows)('%s(%j, %j) is %s', (op, actual, expected, result) => {
    expect(evaluateCondition({ field: 'f', op, value: expected }, { f: actual })).toBe(result);
  });

  it.each([undefined, null, '', '   '])('treats %j as a blank field', (blank) => {
    const context = { f: blank };
    for (const op of ['equals', 'starts_with', 'contains', 'gt', 'lt', 'date_before'] as const) {
      expect(evaluateCondition({ field: 'f', op, value: 1 }, context)).toBe(false);
    }
    expect(evaluateCondition({ field: 'f', op: 'not_equals', value: 'x' }, context)).toBe(true);
  });

  it('treats an absent field as blank', () => {
    expect(evaluateCondition({ field: 'missing', op: 'equals', value: 'x' }, {})).toBe(false);
  });

  it('does not read thousands separators as a number', () => {
    expect(evaluateCondition({ field: 'f', op: 'gt', value: 1_000_000 }, { f: '1.500.000' })).toBe(false);
  });

  it.each([
    ['date_before', '2026-01-10', '2026-01-10T00:00:01Z', true],
    ['date_on_or_before', '2026-01-10', '2026-01-10T00:00:00Z', true],
    ['date_after', '2026-01-10T00:00:01Z', '2026-01-10', true],
    ['date_before', '2026-01-10T00:00:00Z', '2026-01-10', false],
  ] as const)('takes a day as midnight UTC when compared with a date-time (%s %s %s)', (op, actual, expected, result) => {
    expect(evaluateCondition({ field: 'f', op, value: expected }, { f: actual })).toBe(result);
  });

  it('compares Date instances', () => {
    const condition: Condition = { field: 'f', op: 'date_after', value: '2026-01-01' };
    expect(evaluateCondition(condition, { f: new Date('2026-06-01T00:00:00Z') })).toBe(true);
    expect(evaluateCondition(condition, { f: new Date('invalid') })).toBe(false);
  });

  it.each([
    ['an unknown operator', { field: 'f', op: 'matches', value: 'x' }],
    ['a missing field code', { field: '', op: 'equals', value: 'x' }],
    ['in_list without a list', { field: 'f', op: 'in_list', value: 'x' }],
  ])('rejects %s', (_label, condition) => {
    expect(() => evaluateCondition(condition as unknown as Condition, { f: 'x' })).toThrow(InvalidConditionError);
  });
});

describe('evaluateConditions', () => {
  const conditions: Condition[] = [
    { field: 'amount', op: 'gte', value: 1_000_000 },
    { field: 'city', op: 'in_list', value: ['Popayán', 'Cali'] },
  ];

  it.each([
    [{ amount: 2_000_000, city: 'Cali' }, true],
    [{ amount: 2_000_000, city: 'Pasto' }, false],
    [{ amount: 10, city: 'Cali' }, false],
    [{ city: 'Cali' }, false],
  ])('combines conditions with AND for %j', (context, expected) => {
    expect(evaluateConditions(conditions, context)).toBe(expected);
  });

  it('is satisfied by an empty list', () => {
    expect(evaluateConditions([], {})).toBe(true);
  });

  it('stops at the first false condition', () => {
    const invalid = { field: 'f', op: 'nope', value: 1 } as unknown as Condition;
    expect(() => evaluateConditions([{ field: 'f', op: 'equals', value: 'z' }, invalid], { f: 'a' })).not.toThrow();
  });
});
