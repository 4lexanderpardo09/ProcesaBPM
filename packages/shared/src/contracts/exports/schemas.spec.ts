import { describe, expect, it } from 'vitest';
import { exportColumnSchema, parseTableSumReference } from './schemas.js';

describe('parseTableSumReference', () => {
  it('reads columns, type filters and whole fields joined by ;', () => {
    expect(parseTableSumReference('ALIMENTACION;CONCEPTOS:SUBTOTAL:TIPO=Transporte| Peajes ')).toEqual([
      { field: 'ALIMENTACION', column: null, filter: null },
      { field: 'CONCEPTOS', column: 'SUBTOTAL', filter: { column: 'TIPO', values: ['Transporte', 'Peajes'] } },
    ]);
    expect(parseTableSumReference('GASTOS:VALOR')).toEqual([{ field: 'GASTOS', column: 'VALOR', filter: null }]);
  });

  it('refuses malformed parts', () => {
    for (const bad of ['', 'gastos:VALOR', 'GASTOS:', 'GASTOS:VALOR:TIPO', 'GASTOS:VALOR:TIPO=', 'GASTOS:VALOR:=a', 'A:B:C=d:E', 'A;;B']) expect(parseTableSumReference(bad)).toBeNull();
  });

  it('is what a TABLE_SUM column accepts', () => {
    expect(exportColumnSchema.safeParse({ header: 'Movilidad', sourceType: 'TABLE_SUM', sourceRef: 'CONCEPTOS:SUBTOTAL:TIPO=Transporte|Combustible' }).success).toBe(true);
    expect(exportColumnSchema.safeParse({ header: 'Movilidad', sourceType: 'TABLE_SUM', sourceRef: 'CONCEPTOS:SUBTOTAL:TIPO' }).success).toBe(false);
  });
});
