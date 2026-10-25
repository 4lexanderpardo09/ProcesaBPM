import { describe, expect, it } from 'vitest';
import type { FieldDocument } from '../workflow/document.js';
import { computeFieldValues } from '../engine/formulas/compute-field-values.js';
import { FormulaRuntimeError } from '../engine/formulas/evaluate.js';
import { findCalculator, listCalculators } from './registry.js';

const config = {
  tables: [
    {
      code: 'COMIDAS',
      name: 'Comidas',
      slots: [
        { name: 'Desayuno', from: '06:00', to: '08:00', amount: '10000' },
        { name: 'Almuerzo', from: '12:00', to: '14:00', amount: '15000.50' },
        { name: 'Cena', from: '18:00', to: '20:00', amount: '20000' },
      ],
    },
    { code: 'NOCTURNO', name: 'Recargo nocturno', slots: [{ name: 'Noche', from: '22:00', to: '06:00', amount: '30000' }] },
  ],
};
const slots = findCalculator('TIME_SLOTS')!;
const compute = (departure: string | null, back: string | null, timeZone = 'America/Bogota', table?: string) =>
  slots.compute({ departure, return: back }, config, { timeZone, ...(table === undefined ? {} : { options: { table } }) })?.toPlainString() ?? null;

describe('TIME_SLOTS', () => {
  it('is the built-in calculator; the old meal allowance code still finds it', () => {
    expect(listCalculators().map((calculator) => calculator.code)).toEqual(['TIME_SLOTS']);
    expect(findCalculator('MEAL_ALLOWANCE')).toBe(slots);
    expect(findCalculator('NOPE')).toBeUndefined();
  });

  it('validates the organization\'s rate tables: their codes, names, slots and amounts', () => {
    expect(slots.configSchema.safeParse(config).success).toBe(true);
    expect(slots.configSchema.safeParse({ tables: [] }).success).toBe(false);
    expect(slots.configSchema.safeParse({ tables: [config.tables[0], config.tables[0]] }).success).toBe(false);
    expect(slots.configSchema.safeParse({ tables: [{ code: 'mal', name: 'x', slots: config.tables[1]!.slots }] }).success).toBe(false);
    expect(slots.configSchema.safeParse({ tables: [{ code: 'A', name: 'x', slots: [{ name: 'S', from: '09:00', to: '09:00', amount: '1' }] }] }).success).toBe(false);
    expect(slots.configSchema.safeParse({ tables: [{ code: 'A', name: 'x', slots: [config.tables[1]!.slots[0], config.tables[1]!.slots[0]] }] }).success).toBe(false);
    expect(slots.configSchema.safeParse({ meals: [] }).success).toBe(false);
  });

  it('pays each slot of the chosen table whose start the span covers, on every local day', () => {
    // Mon 11:00 to Tue 13:00 in Bogota: lunch + dinner, then breakfast + lunch.
    expect(compute('2026-10-05T16:00:00.000Z', '2026-10-06T18:00:00.000Z', 'America/Bogota', 'COMIDAS')).toBe('60001');
    // The same span on the night table: 22:00 on Monday only.
    expect(compute('2026-10-05T16:00:00.000Z', '2026-10-06T18:00:00.000Z', 'America/Bogota', 'NOCTURNO')).toBe('30000');
  });

  it('uses the first table when the field names none, and refuses a table the organization does not have', () => {
    expect(compute('2026-10-05T16:00:00.000Z', '2026-10-06T18:00:00.000Z')).toBe('60001');
    expect(() => compute('2026-10-05T16:00:00.000Z', '2026-10-06T18:00:00.000Z', 'America/Bogota', 'GONE')).toThrow(FormulaRuntimeError);
  });

  it('pays nothing for a span between slots and uses the company time zone', () => {
    expect(compute('2026-10-05T20:30:00.000Z', '2026-10-05T21:00:00.000Z')).toBe('0');
    expect(compute('2026-10-05T23:30:00.000Z', '2026-10-06T00:30:00.000Z')).toBe('0');
    expect(compute('2026-10-05T11:30:00.000Z', '2026-10-05T12:30:00.000Z', 'UTC')).toBe('15000.5');
  });

  it('is blank while an input is missing and refuses an end before the start', () => {
    expect(compute(null, '2026-10-05T16:00:00.000Z')).toBeNull();
    expect(() => compute('2026-10-06T16:00:00.000Z', '2026-10-05T16:00:00.000Z')).toThrow(FormulaRuntimeError);
    expect(() => compute('not a date', '2026-10-05T16:00:00.000Z')).toThrow(FormulaRuntimeError);
    expect(() => compute('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z')).toThrow(FormulaRuntimeError);
  });
});

function field(code: string, type: FieldDocument['type'], fieldConfig: Record<string, unknown> = {}): FieldDocument {
  return { id: code, stepId: 'S', code, label: code, type, capture: 'STEP', isRequired: false, isReadOnly: false, sortOrder: 0, config: fieldConfig, dataSource: null } as FieldDocument;
}

describe('CALCULATOR fields in computeFieldValues', () => {
  const fields = [
    field('LEAVES', 'DATETIME'),
    field('BACK', 'DATETIME'),
    field('ALLOWANCE', 'CALCULATOR', { calculatorCode: 'TIME_SLOTS', inputs: { departure: 'LEAVES', return: 'BACK' }, table: 'COMIDAS' }),
    field('TOTAL', 'FORMULA', { expression: 'ALLOWANCE * 2', resultType: 'CURRENCY' }),
  ];
  const context = { today: '2026-10-05', timeZone: 'America/Bogota', calculatorConfigs: new Map([['TIME_SLOTS', config]]) };

  it('feeds the formulas that read it', () => {
    const result = computeFieldValues(fields, { LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-06T18:00:00.000Z' }, context);
    expect(result.values).toEqual({ ALLOWANCE: 60001, TOTAL: 120002 });
  });

  it('fails when the calculator is not configured or unknown', () => {
    const values = { LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-06T18:00:00.000Z' };
    expect(computeFieldValues(fields, values, { today: '2026-10-05' }).failures).toEqual(expect.arrayContaining([{ fieldCode: 'ALLOWANCE', reason: 'CALCULATOR_NOT_CONFIGURED', strict: false }]));
    const unknown = [field('X', 'CALCULATOR', { calculatorCode: 'NOPE' })];
    expect(computeFieldValues(unknown, {}, context).failures).toEqual([{ fieldCode: 'X', reason: 'CALCULATOR_UNKNOWN', strict: false }]);
  });

  it('is strict when the inputs were just captured', () => {
    const result = computeFieldValues(fields, { LEAVES: '2026-10-06T16:00:00.000Z', BACK: '2026-10-05T16:00:00.000Z' }, { ...context, captured: new Set(['LEAVES']) });
    expect(result.failures).toEqual(expect.arrayContaining([{ fieldCode: 'ALLOWANCE', reason: 'ARGUMENT_OUT_OF_RANGE', strict: true }]));
  });
});
