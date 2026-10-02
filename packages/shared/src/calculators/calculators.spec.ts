import { describe, expect, it } from 'vitest';
import type { FieldDocument } from '../workflow/document.js';
import { computeFieldValues } from '../engine/formulas/compute-field-values.js';
import { FormulaRuntimeError } from '../engine/formulas/evaluate.js';
import { findCalculator, listCalculators } from './registry.js';

const config = {
  meals: [
    { code: 'BREAKFAST', from: '06:00', to: '08:00', amount: '10000' },
    { code: 'LUNCH', from: '12:00', to: '14:00', amount: '15000.50' },
    { code: 'DINNER', from: '18:00', to: '20:00', amount: '20000' },
  ],
};
const meals = findCalculator('MEAL_ALLOWANCE')!;
const compute = (departure: string | null, back: string | null, timeZone = 'America/Bogota') => meals.compute({ departure, return: back }, config, { timeZone })?.toPlainString() ?? null;

describe('MEAL_ALLOWANCE', () => {
  it('is the only built-in calculator and validates its configuration', () => {
    expect(listCalculators().map((calculator) => calculator.code)).toEqual(['MEAL_ALLOWANCE']);
    expect(meals.configSchema.safeParse(config).success).toBe(true);
    expect(meals.configSchema.safeParse({ meals: [] }).success).toBe(false);
    expect(meals.configSchema.safeParse({ meals: [{ code: 'A', from: '09:00', to: '08:00', amount: '1' }] }).success).toBe(false);
    expect(meals.configSchema.safeParse({ meals: [config.meals[0], config.meals[0]] }).success).toBe(false);
    expect(meals.configSchema.safeParse({ meals: config.meals, extra: 1 }).success).toBe(false);
  });

  it('pays each meal whose window start the trip covers, on every local day', () => {
    // Mon 11:00 to Tue 13:00 in Bogota: lunch + dinner, then breakfast + lunch.
    expect(compute('2026-10-05T16:00:00.000Z', '2026-10-06T18:00:00.000Z')).toBe('60001');
  });

  it('pays nothing for a trip between meals and uses the company time zone', () => {
    expect(compute('2026-10-05T20:30:00.000Z', '2026-10-05T21:00:00.000Z')).toBe('0');
    // 23:30 UTC on the 5th is 18:30 in Bogota: dinner already started, so it is not covered.
    expect(compute('2026-10-05T23:30:00.000Z', '2026-10-06T00:30:00.000Z')).toBe('0');
    // The same instants in UTC: the 6th starts 00:30 UTC, nothing either, but 12:00Z..13:00Z on the 5th pays lunch.
    expect(compute('2026-10-05T11:30:00.000Z', '2026-10-05T12:30:00.000Z', 'UTC')).toBe('15000.5');
  });

  it('is blank while an input is missing and refuses a return before the departure', () => {
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
    field('ALLOWANCE', 'CALCULATOR', { calculatorCode: 'MEAL_ALLOWANCE', inputs: { departure: 'LEAVES', return: 'BACK' } }),
    field('TOTAL', 'FORMULA', { expression: 'ALLOWANCE * 2', resultType: 'CURRENCY' }),
  ];
  const context = { today: '2026-10-05', timeZone: 'America/Bogota', calculatorConfigs: new Map([['MEAL_ALLOWANCE', config]]) };

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
