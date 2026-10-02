export interface CalculatorResponse {
  readonly code: string;
  readonly parameters: ReadonlyArray<{ readonly name: string; readonly type: string; readonly required: boolean }>;
  readonly output: 'CURRENCY' | 'NUMBER';
  /** The tenant switched it on (has a configuration). */
  readonly configured: boolean;
  /** The current configuration, `null` while it is off. */
  readonly config: Record<string, unknown> | null;
}
