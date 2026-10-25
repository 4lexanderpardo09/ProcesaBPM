import { z } from 'zod';

export interface CalculatorResponse {
  readonly code: string;
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly type: string; readonly required: boolean }>;
  readonly output: 'CURRENCY' | 'NUMBER';
  /** The tenant switched it on (has a configuration). */
  readonly configured: boolean;
  /** The current configuration, `null` while it is off. */
  readonly config: Record<string, unknown> | null;
}

/**
 * `GET /calculators/choices`: what a workflow designer may pick for each switched-on calculator (the names of its
 * tables), without its amounts or other settings.
 */
export const calculatorChoicesSchema = z.array(z.object({ code: z.string(), tables: z.array(z.object({ code: z.string(), name: z.string() })) }));
export type CalculatorChoicesResponse = z.infer<typeof calculatorChoicesSchema>;
