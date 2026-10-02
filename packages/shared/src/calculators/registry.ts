import { MEAL_ALLOWANCE } from './meal-allowance.js';
import type { CalculatorDefinition } from './types.js';

const BUILT_IN: readonly CalculatorDefinition[] = [MEAL_ALLOWANCE];
const BY_CODE: ReadonlyMap<string, CalculatorDefinition> = new Map(BUILT_IN.map((calculator) => [calculator.code, calculator]));

export const listCalculators = (): readonly CalculatorDefinition[] => BUILT_IN;
export const findCalculator = (code: string): CalculatorDefinition | undefined => BY_CODE.get(code);
