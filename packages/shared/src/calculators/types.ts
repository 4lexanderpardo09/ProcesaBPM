import type { z } from 'zod';
import type { Decimal } from '../engine/money/fixed-decimal.js';

export type CalculatorInputType = 'DATETIME' | 'DATE' | 'NUMBER' | 'TEXT';

export interface CalculatorParameter {
  readonly name: string;
  readonly type: CalculatorInputType;
  readonly required: boolean;
}

export interface CalculatorContext {
  /** Time zone of the company the ticket belongs to. */
  readonly timeZone: string;
}

/**
 * A built-in, pure calculation a tenant can switch on and tune. It never reads anything but its inputs, its
 * configuration and the context: the engine stores the result like any other field value.
 */
export interface CalculatorDefinition {
  readonly code: string;
  readonly parameters: readonly CalculatorParameter[];
  /** How the result is stored: an amount of money rounded to 2 decimals, or a plain number. */
  readonly output: 'CURRENCY' | 'NUMBER';
  readonly configSchema: z.ZodType<Record<string, unknown>>;
  /** `null` when an input is missing; throws `FormulaRuntimeError` when the inputs cannot produce a value. */
  compute(inputs: Readonly<Record<string, unknown>>, config: Record<string, unknown>, context: CalculatorContext): Decimal | null;
}
