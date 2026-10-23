import type { FormFieldResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { choiceSourceOf, decimalText, initialInput, isBlankInput, requestValue } from './step-values';

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

describe('choiceSourceOf', () => {
  it('asks the API for people, sites, presets and datasets, and not for lists with their own options', () => {
    expect(choiceSourceOf(field('USER'))).toBe('REFERENCE');
    expect(choiceSourceOf(field('SITE'))).toBe('REFERENCE');
    expect(choiceSourceOf(field('MULTI_SELECT', {}, { kind: 'PRESET', preset: 'USERS' }))).toBe('REFERENCE');
    expect(choiceSourceOf(field('SELECT', {}, { kind: 'DATASET', datasetId: 'x', column: 'c' }))).toBe('DATASET');
    expect(choiceSourceOf(field('TEXT', {}, { kind: 'DATASET', datasetId: 'x', column: 'c' }))).toBe('DATASET');
    expect(choiceSourceOf(field('SELECT', { options }))).toBeUndefined();
    expect(choiceSourceOf(field('TEXT'))).toBeUndefined();
  });
});

describe('decimalText', () => {
  it.each([
    ['1250000', '1250000'],
    ['1.250.000,50', '1250000.50'],
    ['99,5', '99.5'],
    [' 12.75 ', '12.75'],
    ['-3', '-3'],
    ['350.000', '350000'],
    ['1.250.000', '1250000'],
    ['1.5', '1.5'],
    ['1234.567', '1234.567'],
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

describe('tables', () => {
  const table = field('TABLE', {
    columns: [
      { code: 'item', label: 'Ítem', type: 'TEXT' },
      { code: 'price', label: 'Precio', type: 'CURRENCY' },
      { code: 'on', label: 'Fecha', type: 'DATE' },
    ],
  });

  it('drops blank rows, leaves out blank cells and sends numbers as decimal text', () => {
    expect(requestValue(table, [{ item: ' Papel ', price: '1.200,50', on: '' }, { item: '', price: ' ' }, { price: '3' }])).toEqual({ ok: true, value: [{ item: 'Papel', price: '1200.50' }, { price: '3' }] });
  });

  it('refuses a number cell that is not a number, and reads only blank rows as blank', () => {
    expect(requestValue(table, [{ price: 'mil' }])).toEqual({ ok: false });
    expect(isBlankInput([{ item: ' ' }])).toBe(true);
    expect(requestValue(table, [])).toEqual({ ok: true, value: [] });
  });

  it('shows the rows the ticket already has as text', () => {
    expect(initialInput(table, [{ item: 'Papel', price: 1200.5 }])).toEqual([{ item: 'Papel', price: '1200.5' }]);
    expect(initialInput(table, null)).toEqual([]);
  });

  it('keeps the files of a file cell as a list, and a row with only files is not blank', () => {
    const receipts = field('TABLE', { columns: [{ code: 'item', label: 'Ítem', type: 'TEXT' }, { code: 'proof', label: 'Soporte', type: 'FILE' }] });
    expect(initialInput(receipts, [{ item: 'Taxi', proof: ['f-1'] }])).toEqual([{ item: 'Taxi', proof: ['f-1'] }]);
    expect(requestValue(receipts, [{ item: '', proof: ['f-1'] }, { item: 'Sin soporte', proof: [] }])).toEqual({ ok: true, value: [{ proof: ['f-1'] }, { item: 'Sin soporte' }] });
    expect(isBlankInput([{ item: '', proof: [] }])).toBe(true);
  });
});

describe('initialInput', () => {
  it('shows what the ticket already has', () => {
    expect(initialInput(field('NUMBER'), 12.5)).toBe('12.5');
    expect(initialInput(field('MULTI_SELECT', { options }), ['yes'])).toEqual(['yes']);
    expect(initialInput(field('TEXT'), null)).toBe('');
    expect(initialInput(field('FILE'), ['018f0000-0000-7000-8000-000000000003'])).toEqual(['018f0000-0000-7000-8000-000000000003']);
  });
});
