import type { FormFieldResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { decimalText, initialInput, isCapturable, requestValue } from './step-values';

const field = (type: FormFieldResponse['type'], config: Record<string, unknown> = {}, dataSource: Record<string, unknown> | null = null): FormFieldResponse => ({
  id: '018f0000-0000-7000-8000-000000000001',
  stepId: '018f0000-0000-7000-8000-000000000002',
  code: 'VALUE',
  label: 'Valor',
  type,
  isRequired: false,
  isReadOnly: false,
  sortOrder: 1,
  config,
  dataSource,
});

const options = [{ value: 'yes', label: 'Sí' }];

describe('isCapturable', () => {
  it('captures plain inputs and lists with their own options', () => {
    expect(['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DAYS', 'DATE', 'DATETIME'].every((type) => isCapturable(field(type as FormFieldResponse['type'])))).toBe(true);
    expect(isCapturable(field('SELECT', { options }))).toBe(true);
    expect(isCapturable(field('MULTI_SELECT', { options }))).toBe(true);
  });

  it('leaves for later people, sites, tables, files, computed fields and lists from presets or datasets', () => {
    expect(['USER', 'SITE', 'TABLE', 'FILE', 'FORMULA', 'CALCULATOR'].some((type) => isCapturable(field(type as FormFieldResponse['type'])))).toBe(false);
    expect(isCapturable(field('SELECT', {}, { kind: 'PRESET', preset: 'USERS' }))).toBe(false);
    expect(isCapturable(field('TEXT', {}, { kind: 'DATASET', datasetId: 'x', column: 'c' }))).toBe(false);
  });
});

describe('decimalText', () => {
  it.each([
    ['1250000', '1250000'],
    ['1.250.000,50', '1250000.50'],
    ['99,5', '99.5'],
    [' 12.75 ', '12.75'],
    ['-3', '-3'],
  ])('reads %s as %s', (input, expected) => {
    expect(decimalText(input)).toBe(expected);
  });

  it('rejects what is not a number', () => {
    expect(decimalText('doce')).toBeUndefined();
    expect(decimalText('1,2,3')).toBeUndefined();
  });
});

describe('requestValue', () => {
  it('sends blank as no value and lists as they are', () => {
    expect(requestValue(field('TEXT'), '  ')).toEqual({ ok: true, value: null });
    expect(requestValue(field('MULTI_SELECT', { options }), ['yes'])).toEqual({ ok: true, value: ['yes'] });
  });

  it('sends decimals as text, days as an integer and trims text', () => {
    expect(requestValue(field('CURRENCY'), '1.250.000,00')).toEqual({ ok: true, value: '1250000.00' });
    expect(requestValue(field('DAYS'), '3')).toEqual({ ok: true, value: 3 });
    expect(requestValue(field('DAYS'), '3.5')).toEqual({ ok: false });
    expect(requestValue(field('TEXT'), ' hola ')).toEqual({ ok: true, value: 'hola' });
  });

  it('sends a local date-time with its instant', () => {
    const result = requestValue(field('DATETIME'), '2026-10-20T14:30');
    expect(result.ok && new Date(result.value as string).getTime()).toBe(new Date('2026-10-20T14:30').getTime());
  });
});

describe('initialInput', () => {
  it('shows what the ticket already has', () => {
    expect(initialInput(field('NUMBER'), 12.5)).toBe('12.5');
    expect(initialInput(field('MULTI_SELECT', { options }), ['yes'])).toEqual(['yes']);
    expect(initialInput(field('TEXT'), null)).toBe('');
  });
});
