import { DATASET_MAX_COLUMNS, DATASET_MAX_ROWS, DatasetFileInvalidError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { buildDatasetSheet, cellText } from './dataset-sheet.js';

const problemOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    if (error instanceof DatasetFileInvalidError) return error.details;
    throw error;
  }
  return undefined;
};

describe('cellText', () => {
  it('keeps every value as the text a form would send', () => {
    expect(cellText(1234567890)).toBe('1234567890');
    expect(cellText(1.5)).toBe('1.5');
    expect(cellText('  Bogotá ')).toBe('Bogotá');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(null)).toBe('');
  });

  it('writes a date without time as YYYY-MM-DD and keeps the time otherwise', () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 9)))).toBe('2026-10-09');
    expect(cellText(new Date(Date.UTC(2026, 9, 9, 14, 30)))).toBe('2026-10-09T14:30:00.000Z');
  });
});

describe('buildDatasetSheet', () => {
  it('reads the headers, skips empty rows and ignores cells past the last header', () => {
    const sheet = buildDatasetSheet(
      [
        ['CEDULA', 'NOMBRE', null],
        [123, 'Ana', 'ignored'],
        [null, null, null],
        [456, null],
      ],
      undefined,
    );
    expect(sheet.columns).toEqual([
      { name: 'CEDULA', isKey: false },
      { name: 'NOMBRE', isKey: false },
    ]);
    expect(sheet.keyColumn).toBeNull();
    expect(sheet.rows).toEqual([
      { data: { CEDULA: '123', NOMBRE: 'Ana' }, lookupKey: null },
      { data: { CEDULA: '456' }, lookupKey: null },
    ]);
  });

  it('takes the key column whatever its case and indexes each row by it', () => {
    const sheet = buildDatasetSheet([['Cedula', 'Nombre'], [123, 'Ana'], [456, 'Luis']], 'CEDULA');
    expect(sheet.keyColumn).toBe('Cedula');
    expect(sheet.columns[0]).toEqual({ name: 'Cedula', isKey: true });
    expect(sheet.rows.map((row) => row.lookupKey)).toEqual(['123', '456']);
  });

  it('refuses headers that cannot name a column', () => {
    expect(problemOf(() => buildDatasetSheet([], undefined))).toEqual({ problem: 'NO_HEADERS' });
    expect(problemOf(() => buildDatasetSheet([['A', null, 'C'], [1, 2, 3]], undefined))).toEqual({ problem: 'EMPTY_HEADER', detail: 2 });
    expect(problemOf(() => buildDatasetSheet([['Name', 'NAME'], [1, 2]], undefined))).toEqual({ problem: 'DUPLICATE_HEADER', detail: 'NAME' });
    expect(problemOf(() => buildDatasetSheet([Array.from({ length: DATASET_MAX_COLUMNS + 1 }, (_v, i) => `C${i}`)], undefined))).toEqual({ problem: 'TOO_MANY_COLUMNS', detail: DATASET_MAX_COLUMNS });
  });

  it('refuses a sheet without rows or with too many', () => {
    expect(problemOf(() => buildDatasetSheet([['A'], [null]], undefined))).toEqual({ problem: 'NO_ROWS' });
    const many = [['A'], ...Array.from({ length: DATASET_MAX_ROWS + 1 }, (_v, i) => [i])];
    expect(problemOf(() => buildDatasetSheet(many, undefined))).toEqual({ problem: 'TOO_MANY_ROWS', detail: DATASET_MAX_ROWS });
  });

  it('refuses an unknown key column, and a key that is missing or repeated (with the spreadsheet row)', () => {
    expect(problemOf(() => buildDatasetSheet([['A'], [1]], 'B'))).toEqual({ problem: 'KEY_COLUMN_UNKNOWN', detail: 'B' });
    expect(problemOf(() => buildDatasetSheet([['K', 'V'], [1, 'a'], [null, 'b']], 'K'))).toEqual({ problem: 'KEY_VALUE_MISSING', detail: 3 });
    expect(problemOf(() => buildDatasetSheet([['K'], [1], [2], [1]], 'K'))).toEqual({ problem: 'KEY_VALUE_REPEATED', detail: 4 });
  });

  it('refuses a cell longer than the limit', () => {
    expect(problemOf(() => buildDatasetSheet([['A'], ['x'.repeat(1001)]], undefined))).toEqual({ problem: 'CELL_TOO_LONG', detail: 2 });
  });
});
