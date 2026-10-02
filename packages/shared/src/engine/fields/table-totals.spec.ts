import { describe, expect, it } from 'vitest';
import { parseFieldConfig } from '../../workflow/field-config.js';
import { normalizeTable } from './normalize-value.js';
import { tableColumnTotals } from './table-totals.js';

const config = {
  columns: [
    { code: 'NAME', type: 'TEXT' },
    { code: 'QTY', type: 'NUMBER', decimals: 3, min: 0, showTotal: true },
    { code: 'AMOUNT', type: 'CURRENCY', showTotal: true },
    { code: 'NOTE', type: 'NUMBER' },
  ],
};

describe('tableColumnTotals', () => {
  it('adds the columns marked showTotal exactly', () => {
    const rows = [{ QTY: 0.1, AMOUNT: 10.1 }, { QTY: 0.2, AMOUNT: '20.2' }, { NAME: 'x' }];
    expect(tableColumnTotals(config, rows)).toEqual({ QTY: '0.3', AMOUNT: '30.3' });
  });

  it('totals zero for empty columns and nothing for a missing table', () => {
    expect(tableColumnTotals(config, [])).toEqual({ QTY: '0', AMOUNT: '0' });
    expect(tableColumnTotals(config, undefined)).toEqual({});
    expect(tableColumnTotals({ columns: [{ code: 'A', type: 'NUMBER' }] }, [{ A: 1 }])).toEqual({});
  });

  it('leaves out a column it cannot add instead of reporting a wrong total', () => {
    expect(tableColumnTotals(config, [{ QTY: 'abc', AMOUNT: 1 }])).toEqual({ AMOUNT: '1' });
  });
});

describe('table columns with decimals, limits and totals', () => {
  const context = { today: '2026-10-02' };

  it('accepts decimals within the column setting and refuses more', () => {
    expect(normalizeTable([{ QTY: 1.125 }], config, context)).toMatchObject({ ok: true });
    expect(normalizeTable([{ QTY: 1.1255 }], config, context)).toMatchObject({ ok: false, cells: [{ rowIndex: 0, column: 'QTY', code: 'TOO_MANY_DECIMALS' }] });
    expect(normalizeTable([{ NOTE: 1.5 }], config, context)).toMatchObject({ ok: false, cells: [{ column: 'NOTE', code: 'TOO_MANY_DECIMALS' }] });
  });

  it('enforces the column minimum', () => expect(normalizeTable([{ QTY: -1 }], config, context)).toMatchObject({ ok: false, cells: [{ column: 'QTY', code: 'OUT_OF_RANGE' }] }));

  it('validates the column definition', () => {
    const table = (column: object) => parseFieldConfig('TABLE', { columns: [{ code: 'A', label: 'A', ...column }] }, null);
    expect(table({ type: 'NUMBER', decimals: 2, min: 0, max: 10, showTotal: true }).valid).toBe(true);
    expect(table({ type: 'CURRENCY', showTotal: true }).valid).toBe(true);
    expect(table({ type: 'TEXT', showTotal: true }).valid).toBe(false);
    expect(table({ type: 'CURRENCY', decimals: 3 }).valid).toBe(false);
    expect(table({ type: 'NUMBER', decimals: 9 }).valid).toBe(false);
  });
});
