import { z } from 'zod';
import { FormulaRuntimeError } from '../engine/formulas/evaluate.js';
import { addDaysToLocalDate, localDateOf, zonedTimeToInstant } from '../engine/business-time/time-zone.js';
import { Decimal, DecimalError } from '../engine/money/fixed-decimal.js';
import type { CalculatorDefinition } from './types.js';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_TRIP_DAYS = 90;

const meal = z
  .object({
    code: z.string().min(1).max(50),
    from: z.string().regex(TIME),
    to: z.string().regex(TIME),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  })
  .strict()
  .refine((entry) => entry.from < entry.to, 'A meal window must end after it starts');

const configSchema = z
  .object({ meals: z.array(meal).min(1).max(10) })
  .strict()
  .refine((config) => new Set(config.meals.map((entry) => entry.code)).size === config.meals.length, 'Meal codes must be unique');

const minuteOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function instantOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) throw new FormulaRuntimeError('INVALID_VALUE');
  return parsed;
}

/**
 * Meal allowance of a trip: on every local day of the trip, each configured meal is paid when the trip covers the
 * start of that meal's window (the person is away when the meal begins). Amounts are per tenant.
 */
export const MEAL_ALLOWANCE: CalculatorDefinition = {
  code: 'MEAL_ALLOWANCE',
  parameters: [
    { name: 'departure', type: 'DATETIME', required: true },
    { name: 'return', type: 'DATETIME', required: true },
  ],
  output: 'CURRENCY',
  configSchema,
  compute(inputs, config, context) {
    const departure = instantOf(inputs.departure);
    const arrival = instantOf(inputs.return);
    if (departure === null || arrival === null) return null;
    if (arrival < departure) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
    const meals = configSchema.parse(config).meals;
    const lastDay = localDateOf(arrival, context.timeZone);
    let total = Decimal.ZERO;
    let day = localDateOf(departure, context.timeZone);
    for (let counted = 0; ; counted += 1) {
      if (counted > MAX_TRIP_DAYS) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
      for (const entry of meals) {
        const start = zonedTimeToInstant(day, minuteOf(entry.from), context.timeZone);
        if (start >= departure && start <= arrival) total = addAmount(total, entry.amount);
      }
      if (day >= lastDay) return total;
      day = addDaysToLocalDate(day, 1);
    }
  },
};

function addAmount(total: Decimal, amount: string): Decimal {
  try {
    return total.add(Decimal.parse(amount));
  } catch (error) {
    if (error instanceof DecimalError) throw new FormulaRuntimeError(error.reason === 'INVALID_NUMBER' ? 'INVALID_VALUE' : error.reason);
    throw error;
  }
}
