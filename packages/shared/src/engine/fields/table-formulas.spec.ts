import { describe, expect, it } from 'vitest';
import { normalizeTable, type TableColumn } from './normalize-value.js';
import { tableColumnTotals } from './table-totals.js';

const columns: TableColumn[] = [
  { code: 'NAME', type: 'TEXT' },
  { code: 'QTY', type: 'NUMBER' },
  { code: 'PRICE', type: 'CURRENCY' },
  { code: 'SUBTOTAL', type: 'FORMULA', expression: 'QTY * PRICE', showTotal: true },
  { code: 'SHARE', type: 'FORMULA', expression: 'QTY / 3', decimals: 4 },
];
const context = { today: '2026-10-23' };

describe('formula columns of a table', () => {
  it('computes each row from its own cells, rounded, and ignores what the client sent for them', () => {
    const result = normalizeTable(
      [
        { NAME: 'Billete 50.000', QTY: 3, PRICE: '50000', SUBTOTAL: 1 },
        { NAME: 'Moneda 500', QTY: 7, PRICE: 500.5 },
      ],
      { columns },
      context,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { NAME: 'Billete 50.000', QTY: 3, PRICE: 50000, SUBTOTAL: 150000, SHARE: 1 },
        { NAME: 'Moneda 500', QTY: 7, PRICE: 500.5, SUBTOTAL: 3503.5, SHARE: 2.3333 },
      ],
    });
    if (result.ok) expect(tableColumnTotals({ columns }, result.value)).toEqual({ SUBTOTAL: '153503.5' });
  });

  it('leaves the cell empty when the row cannot give it a value', () => {
    const result = normalizeTable([{ NAME: 'Sin cantidad', PRICE: '10' }], { columns: [...columns, { code: 'PER_UNIT', type: 'FORMULA', expression: 'PRICE / QTY' }] }, context);
    expect(result.ok && result.value[0]).toEqual({ NAME: 'Sin cantidad', PRICE: 10 });
  });
});
