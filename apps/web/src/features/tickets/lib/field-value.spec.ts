import type { FormFieldResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { fieldValueDisplay } from './field-value';

const field = (type: FormFieldResponse['type'], config: Record<string, unknown> = {}): FormFieldResponse => ({
  id: '018f0000-0000-7000-8000-000000000001',
  stepId: '018f0000-0000-7000-8000-000000000002',
  code: 'value',
  label: 'Valor',
  type,
  isRequired: false,
  isReadOnly: false,
  sortOrder: 1,
  config,
  dataSource: null,
});

const textOf = (display: ReturnType<typeof fieldValueDisplay>) => (display?.kind === 'text' ? display.text.replace(/\s/g, ' ') : display);

describe('fieldValueDisplay', () => {
  it('shows nothing for an empty value or a file', () => {
    expect(fieldValueDisplay(field('TEXT'), '')).toBeUndefined();
    expect(fieldValueDisplay(field('MULTI_SELECT'), [])).toBeUndefined();
    expect(fieldValueDisplay(field('FILE'), ['018f0000-0000-7000-8000-000000000003'])).toBeUndefined();
  });

  it('shows the label of the chosen options', () => {
    const options = [{ value: 'capital', label: 'Abono a capital' }, { value: 'fee', label: 'Cuota' }];
    expect(textOf(fieldValueDisplay(field('SELECT', { options }), 'capital'))).toBe('Abono a capital');
    expect(textOf(fieldValueDisplay(field('MULTI_SELECT', { options }), ['capital', 'fee']))).toBe('Abono a capital, Cuota');
    expect(textOf(fieldValueDisplay(field('SELECT'), 'from-dataset'))).toBe('from-dataset');
  });

  it('formats numbers and currency in Colombian Spanish, decimals sent as text included', () => {
    expect(textOf(fieldValueDisplay(field('NUMBER', { decimals: 1 }), 1234.56))).toBe('1.234,6');
    expect(textOf(fieldValueDisplay(field('CURRENCY', { currencyCode: 'COP' }), '1250000.00'))).toBe('$ 1.250.000');
    expect(textOf(fieldValueDisplay(field('CURRENCY'), '99.5'))).toBe('99,50');
  });

  it('reads a calendar date the same in every time zone', () => {
    expect(textOf(fieldValueDisplay(field('DATE'), '2026-10-01', 'America/Bogota'))).toBe('1 de oct de 2026');
  });

  it('counts days and table rows', () => {
    expect(fieldValueDisplay(field('DAYS'), 3)).toEqual({ kind: 'days', count: 3 });
    expect(fieldValueDisplay(field('TABLE'), [{}, {}])).toEqual({ kind: 'rows', count: 2 });
  });

  it('marks people and sites as not named yet', () => {
    expect(fieldValueDisplay(field('USER'), '018f0000-0000-7000-8000-000000000004')).toEqual({ kind: 'unnamed' });
  });

  it('formats a formula by its result type', () => {
    expect(textOf(fieldValueDisplay(field('FORMULA', { expression: 'a*b', resultType: 'NUMBER', decimals: 2 }), '10.456'))).toBe('10,46');
  });
});
