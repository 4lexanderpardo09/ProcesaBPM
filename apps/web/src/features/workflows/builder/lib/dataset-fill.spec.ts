import type { DatasetResponse, FieldDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { comparableName, datasetMatches, isFilledFrom } from './dataset-fill';

const field = (code: string, type: FieldDocument['type'] = 'TEXT', dataSource: FieldDocument['dataSource'] = null) =>
  ({ id: code, stepId: 's', code, label: code, type, capture: 'CREATION', isRequired: false, isReadOnly: false, isImmutable: false, sortOrder: 0, config: {}, dataSource }) as FieldDocument;
const employees: DatasetResponse = {
  id: 'd1',
  name: 'Empleados',
  workflowId: null,
  columns: [
    { name: 'Cédula', isKey: true },
    { name: 'Nombre completo', isKey: false },
    { name: 'Cargo', isKey: false },
    { name: 'Salario', isKey: false },
  ],
  keyColumn: 'Cédula',
  rowCount: 3,
  sourceFileName: 'empleados.xlsx',
  loadedAt: '2026-10-25T00:00:00.000Z',
  isActive: true,
};

describe('dataset fill', () => {
  it('compares names without accents, case or spaces', () => {
    expect(comparableName('Nombre completo')).toBe('NOMBRE_COMPLETO');
    expect(comparableName('  Cédula ')).toBe('CEDULA');
    expect(comparableName('N° de cuenta')).toBe('N_DE_CUENTA');
  });

  it('finds the text fields named like a column, apart from the key, and the matches it cannot fill', () => {
    const fields = [field('CEDULA'), field('NOMBRE_COMPLETO'), field('CARGO'), field('SALARIO', 'CURRENCY'), field('NOTAS')];
    const { fillable, unsupported } = datasetMatches(fields, employees, 'CEDULA');
    expect(fillable.map((match) => [match.field.code, match.column])).toEqual([
      ['NOMBRE_COMPLETO', 'Nombre completo'],
      ['CARGO', 'Cargo'],
    ]);
    expect(unsupported.map((match) => match.field.code)).toEqual(['SALARIO']);
  });

  it('tells a field already looked up in that column by that key', () => {
    expect(isFilledFrom(field('CARGO', 'TEXT', { kind: 'DATASET', datasetId: 'd1', column: 'Cargo', lookupFieldCode: 'CEDULA' }), 'd1', 'Cargo', 'CEDULA')).toBe(true);
    expect(isFilledFrom(field('CARGO', 'TEXT', { kind: 'DATASET', datasetId: 'd1', column: 'Cargo' }), 'd1', 'Cargo', 'CEDULA')).toBe(false);
    expect(isFilledFrom(field('CARGO'), 'd1', 'Cargo', 'CEDULA')).toBe(false);
  });
});
