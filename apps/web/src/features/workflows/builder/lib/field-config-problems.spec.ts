import { describe, expect, it } from 'vitest';
import { fieldConfigProblems } from './field-config-problems';

describe('fieldConfigProblems', () => {
  it('accepts what the API accepts', () => {
    expect(fieldConfigProblems('TEXT', {}, null)).toEqual([]);
    expect(fieldConfigProblems('SELECT', { options: [{ value: 'a', label: 'A' }] }, null)).toEqual([]);
    expect(fieldConfigProblems('SELECT', {}, { kind: 'PRESET', preset: 'COMPANIES' })).toEqual([]);
    expect(fieldConfigProblems('TABLE', { columns: [{ code: 'ITEM', label: 'Ítem', type: 'TEXT' }] }, null)).toEqual([]);
    expect(fieldConfigProblems('FORMULA', { expression: 'A * 2', resultType: 'NUMBER' }, null)).toEqual([]);
  });

  it('says what a list is missing', () => {
    expect(fieldConfigProblems('SELECT', {}, null)).toEqual(['needsOptions']);
    expect(fieldConfigProblems('SELECT', { options: [{ value: '', label: 'A' }] }, null)).toEqual(['optionIncomplete']);
    expect(fieldConfigProblems('MULTI_SELECT', { options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }, null)).toEqual(['optionRepeated']);
    expect(fieldConfigProblems('SELECT', {}, { kind: 'DATASET', datasetId: '', column: '' })).toEqual(['datasetIncomplete']);
  });

  it('says what a table is missing', () => {
    expect(fieldConfigProblems('TABLE', { columns: [] }, null)).toEqual(['needsColumns']);
    expect(fieldConfigProblems('TABLE', { columns: [{ code: 'bad code', label: 'X', type: 'TEXT' }] }, null)).toEqual(['columnIncomplete']);
    expect(fieldConfigProblems('TABLE', { columns: [{ code: 'A', label: 'X', type: 'TEXT' }, { code: 'A', label: 'Y', type: 'TEXT' }] }, null)).toEqual(['columnRepeated']);
    expect(fieldConfigProblems('TABLE', { columns: [{ code: 'A', label: 'X', type: 'SELECT', options: [] }] }, null)).toEqual(['columnOptions']);
  });

  it('asks for a formula, a calculator, a kind of file and a sensible range', () => {
    expect(fieldConfigProblems('FORMULA', { expression: ' ', resultType: 'NUMBER' }, null)).toEqual(['needsExpression']);
    expect(fieldConfigProblems('CALCULATOR', {}, null)).toEqual(['needsCalculator']);
    expect(fieldConfigProblems('FILE', { accept: [] }, null)).toEqual(['needsFileKind']);
    expect(fieldConfigProblems('NUMBER', { min: 10, max: 1 }, null)).toEqual(['minMax']);
  });

  it('falls back to a general message for anything else the schema refuses', () => {
    expect(fieldConfigProblems('TEXT', { maxLength: 5000 }, null)).toEqual(['configInvalid']);
  });
});
