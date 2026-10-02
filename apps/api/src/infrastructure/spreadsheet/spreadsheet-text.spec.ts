import { describe, expect, it } from 'vitest';
import { MAX_CELL_CHARACTERS, safeCellText, safeSheetName } from './spreadsheet-text.js';

describe('safeCellText', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tTAB', '\rCR', '＝1', '＋1', '－1', '＠x'])('neutralizes %j with an apostrophe', (text) => {
    expect(safeCellText(text)).toBe(`'${text}`);
  });

  it('leaves ordinary text alone, also when a trigger is not the first character', () => {
    expect(safeCellText('Ana Gómez')).toBe('Ana Gómez');
    expect(safeCellText('a=1')).toBe('a=1');
    expect(safeCellText('')).toBe('');
  });

  it('removes characters XML cannot hold and cuts what a cell cannot hold', () => {
    expect(safeCellText('a\u0000b\u0008c')).toBe('abc');
    expect(safeCellText('x'.repeat(MAX_CELL_CHARACTERS + 10))).toHaveLength(MAX_CELL_CHARACTERS);
  });

  it('checks the first character after cleaning', () => {
    expect(safeCellText('\u0000=2')).toBe("'=2");
  });
});

describe('safeSheetName', () => {
  it('removes forbidden characters, cuts to 31 and avoids repeats', () => {
    expect(safeSheetName('Ventas/2026: [Q1]?')).toBe('Ventas 2026   Q1');
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31);
    expect(safeSheetName('SLA', new Set(['sla']))).toBe('SLA 2');
    expect(safeSheetName('')).toBe('Sheet');
  });
});
