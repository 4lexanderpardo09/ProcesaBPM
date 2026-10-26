import type { FormFieldResponse } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { fieldValueDisplay, filteredValueText } from './field-value';

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

const noNames = { users: {}, sites: {}, companies: {}, departments: {}, positions: {} };

const textOf = (display: ReturnType<typeof fieldValueDisplay>) => (display?.kind === 'text' ? display.text.replace(/\s/g, ' ') : display);

describe('fieldValueDisplay', () => {
  it('reads «Días fuera» as the days the person was not away', () => {
    expect(fieldValueDisplay(field('TRIP_DAYS'), ['2026-11-11', '2026-11-12'], noNames)).toEqual({ kind: 'tripDays', atHome: '11 de nov de 2026, 12 de nov de 2026' });
    expect(filteredValueText({ type: 'TRIP_DAYS', options: null }, ['2026-11-11'])).toBe('11 de nov de 2026');
  });

  it('shows nothing for an empty value or a file', () => {
    expect(fieldValueDisplay(field('TEXT'), '', noNames)).toBeUndefined();
    expect(fieldValueDisplay(field('MULTI_SELECT'), [], noNames)).toBeUndefined();
    expect(fieldValueDisplay(field('FILE'), ['018f0000-0000-7000-8000-000000000003'], noNames)).toBeUndefined();
  });

  it('shows the label of the chosen options', () => {
    const options = [{ value: 'capital', label: 'Abono a capital' }, { value: 'fee', label: 'Cuota' }];
    expect(textOf(fieldValueDisplay(field('SELECT', { options }), 'capital', noNames))).toBe('Abono a capital');
    expect(textOf(fieldValueDisplay(field('MULTI_SELECT', { options }), ['capital', 'fee'], noNames))).toBe('Abono a capital, Cuota');
    expect(textOf(fieldValueDisplay(field('SELECT'), 'from-dataset', noNames))).toBe('from-dataset');
    const position = '018f0000-0000-7000-8000-000000000009';
    expect(textOf(fieldValueDisplay(field('MULTI_SELECT'), [position], { ...noNames, positions: { [position]: 'Jefe de compras' } }))).toBe('Jefe de compras');
  });

  it('formats numbers and currency in Colombian Spanish, decimals sent as text included', () => {
    expect(textOf(fieldValueDisplay(field('NUMBER', { decimals: 1 }), 1234.56, noNames))).toBe('1.234,6');
    expect(textOf(fieldValueDisplay(field('CURRENCY', { currencyCode: 'COP' }), '1250000.00', noNames))).toBe('$ 1.250.000');
    expect(textOf(fieldValueDisplay(field('CURRENCY'), '99.5', noNames))).toBe('99,50');
  });

  it('reads a calendar date the same in every time zone', () => {
    expect(textOf(fieldValueDisplay(field('DATE'), '2026-10-01', noNames, 'America/Bogota'))).toBe('1 de oct de 2026');
  });

  it('counts days and table rows', () => {
    expect(fieldValueDisplay(field('DAYS'), 3, noNames)).toEqual({ kind: 'days', count: 3 });
    expect(fieldValueDisplay(field('TABLE'), [{}, {}], noNames)).toEqual({ kind: 'rows', count: 2 });
  });

  it('names people and sites, also in lists of people or sites, and marks ids the organization no longer has', () => {
    const [ana, north, gone] = ['018f0000-0000-7000-8000-000000000004', '018f0000-0000-7000-8000-000000000005', '018f0000-0000-7000-8000-000000000006'];
    const names = { ...noNames, users: { [ana]: 'Ana Pérez' }, sites: { [north]: 'Sede Norte' } };
    expect(textOf(fieldValueDisplay(field('USER'), ana, names))).toBe('Ana Pérez');
    expect(textOf(fieldValueDisplay(field('SITE'), north, names))).toBe('Sede Norte');
    expect(textOf(fieldValueDisplay(field('MULTI_SELECT'), [ana, north], names))).toBe('Ana Pérez, Sede Norte');
    expect(fieldValueDisplay(field('USER'), gone, names)).toEqual({ kind: 'unknown' });
  });

  it('formats a formula by its result type', () => {
    expect(textOf(fieldValueDisplay(field('FORMULA', { expression: 'a*b', resultType: 'NUMBER', decimals: 2 }), '10.456', noNames))).toBe('10,46');
  });
});

describe('filteredValueText', () => {
  it('reads the value of the filtered field by its type, as on the ticket', () => {
    expect(filteredValueText({ type: 'DATE', options: null }, '2026-03-01')).toBe('1 de mar de 2026');
    expect(filteredValueText({ type: 'SELECT', options: [{ value: 'P', label: 'Pagado' }] }, 'P')).toBe('Pagado');
    expect(filteredValueText({ type: 'CURRENCY', options: null }, 250000.5)).toBe('250.000,50');
    expect(filteredValueText({ type: 'NUMBER', options: null }, 1.25)).toBe('1,25');
    expect(filteredValueText({ type: 'TEXT', options: null }, 'Factura')).toBe('Factura');
  });

  it('shows a dash with no value, and the value as is when the field is not known', () => {
    expect(filteredValueText({ type: 'TEXT', options: null }, null)).toBe('—');
    expect(filteredValueText(undefined, 'X-1')).toBe('X-1');
    expect(filteredValueText(undefined, null)).toBe('—');
  });
});
