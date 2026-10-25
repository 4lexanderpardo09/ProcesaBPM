import { compileFormula, type FormulaSchema } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { FORMULA_EXAMPLES } from './FormulaGuide';

const schema: FormulaSchema = {
  fields: new Map([
    ['GASTOS', { kind: 'table', columns: new Map([['VALOR', 'NUMBER']]) }],
    ['ANTICIPO', { kind: 'value', type: 'NUMBER' }],
    ['SALDO', { kind: 'value', type: 'NUMBER' }],
    ['MONTO', { kind: 'value', type: 'NUMBER' }],
    ['SOLICITADO', { kind: 'value', type: 'NUMBER' }],
    ['TOPE', { kind: 'value', type: 'NUMBER' }],
    ['FECHA_INICIO', { kind: 'value', type: 'DATE' }],
    ['FECHA_FIN', { kind: 'value', type: 'DATE' }],
  ]),
};

describe('formula guide', () => {
  it.each(FORMULA_EXAMPLES)('the %s example is a valid formula', (_key, expression) => {
    expect(compileFormula(expression, schema)).toMatchObject({ ok: true });
  });
});
