import type { FieldDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { operatorsFor, parseList, ruleFor, valueKind, withOperator } from './condition-rules';

const field = (type: string, config: Record<string, unknown> = {}): FieldDocument => ({
  id: 'f',
  stepId: 's',
  code: 'AMOUNT',
  label: 'Monto',
  type: type as FieldDocument['type'],
  capture: 'BOTH',
  isRequired: false,
  isReadOnly: false,
    isImmutable: false,
  sortOrder: 0,
  config,
  dataSource: null,
});

describe('condition rules', () => {
  it('offers only the operators that apply to the field', () => {
    expect(operatorsFor(field('NUMBER'))).toContain('gt');
    expect(operatorsFor(field('NUMBER'))).not.toContain('date_before');
    expect(operatorsFor(field('DATE'))).toContain('date_before');
    expect(operatorsFor(field('TEXT'))).not.toContain('gt');
  });

  it('starts a rule with a value of the right kind', () => {
    expect(ruleFor(field('CURRENCY'))).toEqual({ field: 'AMOUNT', op: 'gt', value: 0 });
    expect(ruleFor(field('SELECT', { options: [{ value: 'cash', label: 'Efectivo' }] }))).toEqual({ field: 'AMOUNT', op: 'equals', value: 'cash' });
    expect(ruleFor(field('DATE')).op).toBe('date_on_or_after');
  });

  it('knows how the value is typed', () => {
    expect(valueKind(field('NUMBER'), 'equals')).toBe('number');
    expect(valueKind(field('SELECT', { options: [{ value: 'a', label: 'A' }] }), 'equals')).toBe('option');
    expect(valueKind(field('SELECT', { options: [{ value: 'a', label: 'A' }] }), 'contains')).toBe('text');
    expect(valueKind(field('TEXT'), 'in_list')).toBe('list');
    expect(valueKind(field('DATE'), 'date_before')).toBe('date');
  });

  it('keeps the value when the new operator still takes it, and makes one that fits otherwise', () => {
    const number = field('NUMBER');
    expect(withOperator({ field: 'AMOUNT', op: 'gt', value: 5 }, number, 'lte')).toEqual({ field: 'AMOUNT', op: 'lte', value: 5 });
    expect(withOperator({ field: 'AMOUNT', op: 'gt', value: 5 }, number, 'in_list')).toEqual({ field: 'AMOUNT', op: 'in_list', value: [5] });
    expect(withOperator({ field: 'AMOUNT', op: 'in_list', value: [7, 8] }, number, 'equals')).toEqual({ field: 'AMOUNT', op: 'equals', value: 7 });
  });

  it('reads a list typed with commas', () => {
    expect(parseList(' a, b ,, c ', false)).toEqual(['a', 'b', 'c']);
    expect(parseList('1, 2.5', true)).toEqual([1, 2.5]);
    expect(parseList('  ', false)).toEqual(['']);
  });
});
