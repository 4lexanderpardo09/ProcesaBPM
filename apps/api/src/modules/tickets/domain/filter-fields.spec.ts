import { describe, expect, it } from 'vitest';
import { filterFieldsOf } from './filter-fields.js';

const row = (code: string, label: string, type: 'TEXT' | 'SELECT' | 'DATE', config: unknown = {}, dataSource: unknown = null) => ({ code, label, type, config, dataSource });

describe('filterFieldsOf', () => {
  it('keeps one entry per code, named by the newest version, sorted by label', () => {
    expect(filterFieldsOf([row('DUE_ON', 'Vence el', 'DATE'), row('REF', 'Referencia', 'TEXT'), row('DUE_ON', 'Fecha límite', 'DATE')])).toEqual([
      { code: 'REF', label: 'Referencia', type: 'TEXT', options: null },
      { code: 'DUE_ON', label: 'Vence el', type: 'DATE', options: null },
    ]);
  });

  it('lists the fixed options of a select, not those of a dataset or a preset', () => {
    const options = { options: [{ value: 'capital', label: 'Abono a capital' }, { value: 'raw' }, 'bad'] };
    expect(filterFieldsOf([row('KIND', 'Tipo', 'SELECT', options)])[0]?.options).toEqual([
      { value: 'capital', label: 'Abono a capital' },
      { value: 'raw', label: 'raw' },
    ]);
    expect(filterFieldsOf([row('CITY', 'Ciudad', 'SELECT', {}, { kind: 'DATASET' })])[0]?.options).toBeNull();
    expect(filterFieldsOf([row('KIND', 'Tipo', 'SELECT', { options: 'x' })])[0]?.options).toBeNull();
  });
});
