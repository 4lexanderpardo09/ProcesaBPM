import { z } from 'zod';
import { FormulaRuntimeError } from '../engine/formulas/evaluate.js';
import { Decimal, DecimalError } from '../engine/money/fixed-decimal.js';
import type { CalculatorDefinition } from './types.js';

/** Nothing to tune: switching it on is all a tenant does. */
const configSchema = z.object({}).strict();

function amountOf(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new FormulaRuntimeError('INVALID_VALUE');
  try {
    return Decimal.parse(value);
  } catch (error) {
    if (error instanceof DecimalError) throw new FormulaRuntimeError(error.reason === 'INVALID_NUMBER' ? 'INVALID_VALUE' : error.reason);
    throw error;
  }
}

/**
 * Balance of a trip when it is accounted for, as the help desk's `CALC:saldo_viaticos`: what was advanced minus what
 * was spent. Positive, the person gives the difference back to the company; negative, the company owes it to them;
 * zero, nothing is pending. Each side is usually a formula field that adds up its tables (`SUM(GASTOS.VALOR)`). A side
 * still empty counts as zero; with both empty there is nothing to show yet.
 */
export const TRAVEL_BALANCE: CalculatorDefinition = {
  code: 'TRAVEL_BALANCE',
  parameters: [
    { name: 'advance', type: 'NUMBER', required: true },
    { name: 'spent', type: 'NUMBER', required: true },
  ],
  output: 'CURRENCY',
  configSchema,
  compute(inputs, config) {
    if (!configSchema.safeParse(config).success) throw new FormulaRuntimeError('INVALID_VALUE');
    const advance = amountOf(inputs.advance);
    const spent = amountOf(inputs.spent);
    if (advance === null && spent === null) return null;
    return (advance ?? Decimal.ZERO).sub(spent ?? Decimal.ZERO);
  },
};
