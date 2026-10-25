import { z } from 'zod';
import { FormulaRuntimeError } from '../engine/formulas/evaluate.js';
import { addDaysToLocalDate, localDateOf, zonedTimeToInstant } from '../engine/business-time/time-zone.js';
import { Decimal, DecimalError } from '../engine/money/fixed-decimal.js';
import type { CalculatorDefinition } from './types.js';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TABLE_CODE = /^[A-Z][A-Z0-9_]{0,49}$/;
const MAX_SPAN_DAYS = 90;

const slot = z
  .object({
    name: z.string().trim().min(1).max(100),
    from: z.string().regex(TIME),
    to: z.string().regex(TIME),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  })
  .strict()
  .refine((entry) => entry.from !== entry.to, 'A slot must end at another time than it starts');

const table = z
  .object({
    code: z.string().regex(TABLE_CODE, 'Use capitals, digits and _, starting with a letter'),
    name: z.string().trim().min(1).max(100),
    slots: z.array(slot).min(1).max(24),
  })
  .strict()
  .refine((entry) => new Set(entry.slots.map((item) => item.name)).size === entry.slots.length, 'Slot names must be unique within a rate table');

/** The organization's rate tables: each with its own name and slots (meals, night shifts, weekend turns…). */
export const timeSlotsConfigSchema = z
  .object({ tables: z.array(table).min(1).max(20) })
  .strict()
  .refine((config) => new Set(config.tables.map((entry) => entry.code)).size === config.tables.length, 'Rate table codes must be unique');
export type TimeSlotsConfig = z.infer<typeof timeSlotsConfigSchema>;

const minuteOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function instantOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) throw new FormulaRuntimeError('INVALID_VALUE');
  return parsed;
}

function addAmount(total: Decimal, amount: string): Decimal {
  try {
    return total.add(Decimal.parse(amount));
  } catch (error) {
    if (error instanceof DecimalError) throw new FormulaRuntimeError(error.reason === 'INVALID_NUMBER' ? 'INVALID_VALUE' : error.reason);
    throw error;
  }
}

/**
 * Pay by time slots between a start and an end (a trip, a shift): on every local day of the span, each slot of the
 * chosen rate table is paid when the span covers the moment the slot starts. Nothing is fixed in the code: each
 * organization names its rate tables and their slots, hours and amounts (meals, night surcharges, weekend turns…),
 * and each field or block picks a table (`options.table`; the first one when it names none, as fields made before
 * there were several tables do).
 */
export const TIME_SLOTS: CalculatorDefinition = {
  code: 'TIME_SLOTS',
  parameters: [
    { name: 'departure', type: 'DATETIME', required: true },
    { name: 'return', type: 'DATETIME', required: true },
  ],
  output: 'CURRENCY',
  usesTable: true,
  configSchema: timeSlotsConfigSchema,
  compute(inputs, config, context) {
    const start = instantOf(inputs.departure);
    const end = instantOf(inputs.return);
    if (start === null || end === null) return null;
    if (end < start) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
    const parsed = timeSlotsConfigSchema.safeParse(config);
    if (!parsed.success) throw new FormulaRuntimeError('INVALID_VALUE');
    const wanted = context.options?.table;
    const rates = wanted === undefined ? parsed.data.tables[0] : parsed.data.tables.find((entry) => entry.code === wanted);
    if (rates === undefined) throw new FormulaRuntimeError('INVALID_VALUE');
    const lastDay = localDateOf(end, context.timeZone);
    let total = Decimal.ZERO;
    let day = localDateOf(start, context.timeZone);
    for (let counted = 0; ; counted += 1) {
      if (counted > MAX_SPAN_DAYS) throw new FormulaRuntimeError('ARGUMENT_OUT_OF_RANGE');
      for (const entry of rates.slots) {
        const begins = zonedTimeToInstant(day, minuteOf(entry.from), context.timeZone);
        if (begins >= start && begins <= end) total = addAmount(total, entry.amount);
      }
      if (day >= lastDay) return total;
      day = addDaysToLocalDate(day, 1);
    }
  },
};
