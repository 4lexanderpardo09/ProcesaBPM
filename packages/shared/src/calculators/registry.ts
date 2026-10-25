import { TIME_SLOTS } from './time-slots.js';
import type { CalculatorDefinition } from './types.js';

const BUILT_IN: readonly CalculatorDefinition[] = [TIME_SLOTS];
/** Codes of published versions that predate a rename: they keep resolving to the calculator they meant. */
const ALIASES: Readonly<Record<string, string>> = { MEAL_ALLOWANCE: 'TIME_SLOTS' };
const BY_CODE: ReadonlyMap<string, CalculatorDefinition> = new Map(BUILT_IN.map((calculator) => [calculator.code, calculator]));

export const listCalculators = (): readonly CalculatorDefinition[] => BUILT_IN;
/** The calculator a code names, through the aliases; its own `code` is the one its configuration is stored under. */
export const findCalculator = (code: string): CalculatorDefinition | undefined => BY_CODE.get(ALIASES[code] ?? code);
