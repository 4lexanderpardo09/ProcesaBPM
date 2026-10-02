import { findCalculator } from '../../calculators/registry.js';
import { InvalidStateError, NoMatchingBranchError, NotImplementedError } from '../../errors/domain-error.js';
import { PEOPLE_STEP_TYPES, type StepType } from '../../workflow/constants.js';
import type { StepDocument, TransitionDocument, WorkflowVersionDocument } from '../../workflow/document.js';
import { evaluateConditions } from '../conditions/evaluate-conditions.js';
import { computeFieldValues, storableNumber, type ComputeContext, type FormulaFailure } from '../formulas/compute-field-values.js';
import { FormulaRuntimeError } from '../formulas/evaluate.js';

/** Automatic blocks whose work happens outside the request (the worker); the engine only enqueues it and moves on. */
export const SIDE_EFFECT_BLOCK_TYPES: ReadonlySet<StepType> = new Set(['DOCUMENT', 'NOTIFICATION', 'WEBHOOK', 'EXPORT']);
const MAX_HOPS = 100;

export interface RouteHop {
  /** The automatic block the ticket left. */
  readonly stepId: string;
  readonly blockType: StepType;
  readonly transitionId: string;
  readonly toStepId: string;
}

export interface RouteResult {
  readonly hops: readonly RouteHop[];
  readonly arrival: { readonly stepId: string; readonly kind: 'PEOPLE' | 'END' };
  /** The ticket's values once the CALCULATOR blocks on the way have run (the input values when none did). */
  readonly values: Readonly<Record<string, unknown>>;
  /** What the blocks changed, by field code. */
  readonly changed: Readonly<Record<string, unknown>>;
  /** Calculators and formulas that could not produce a value on the way: stored blank, to be recorded. */
  readonly failures: readonly FormulaFailure[];
}

interface CalculatorBlockConfig {
  readonly calculatorCode: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputFieldCode: string;
}

/** Runs one CALCULATOR block: stores its result in the output field, or blank when it cannot produce one. */
function runCalculatorBlock(config: CalculatorBlockConfig, values: Record<string, unknown>, context: ComputeContext, failures: FormulaFailure[]): void {
  const fail = (reason: FormulaFailure['reason']): void => {
    values[config.outputFieldCode] = null;
    failures.push({ fieldCode: config.outputFieldCode, reason, strict: false });
  };
  const calculator = findCalculator(config.calculatorCode);
  if (calculator === undefined) return fail('CALCULATOR_UNKNOWN');
  const calculatorConfig = context.calculatorConfigs?.get(calculator.code);
  if (calculatorConfig === undefined) return fail('CALCULATOR_NOT_CONFIGURED');
  try {
    const named = Object.fromEntries(Object.entries(config.inputs).map(([name, code]) => [name, values[code]]));
    const result = calculator.compute(named, calculatorConfig, { timeZone: context.timeZone ?? 'UTC' });
    values[config.outputFieldCode] = result === null ? null : storableNumber(result.round(calculator.output === 'CURRENCY' ? 2 : 6));
  } catch (error) {
    if (!(error instanceof FormulaRuntimeError)) throw error;
    fail(error.code);
  }
}

/**
 * Follows the automatic blocks from `entryStepId` until the ticket reaches a people step or the end. Pure:
 * CONDITION blocks take the first branch (in canvas order) whose rule holds, else their DEFAULT; the others
 * take their DEFAULT. A CALCULATOR block stores its result and the computed fields are recalculated before
 * the next block reads them. A WAIT block stops the whole operation: it is not implemented yet, so the
 * ticket never silently skips it.
 */
export function routeThroughAutomaticBlocks(doc: WorkflowVersionDocument, entryStepId: string, values: Readonly<Record<string, unknown>>, context?: ComputeContext): RouteResult {
  const steps = new Map<string, StepDocument>(doc.steps.map((step) => [step.id, step]));
  const hops: RouteHop[] = [];
  const current: Record<string, unknown> = { ...values };
  const failures: FormulaFailure[] = [];
  const result = (arrival: RouteResult['arrival']): RouteResult => ({ hops, arrival, values: current, changed: changedOf(values, current), failures });
  let step = steps.get(entryStepId);
  while (step !== undefined) {
    if (step.type === 'END') return result({ stepId: step.id, kind: 'END' });
    if (PEOPLE_STEP_TYPES.has(step.type)) return result({ stepId: step.id, kind: 'PEOPLE' });
    if (step.type === 'WAIT' || (step.type === 'CALCULATOR' && context === undefined)) throw new NotImplementedError(`${step.type} blocks`);
    if (hops.length >= MAX_HOPS) throw new InvalidStateError('The workflow loops through automatic blocks without reaching a person');
    if (step.type === 'CALCULATOR') recalculateAfter(doc, step, current, context!, failures);
    const exit = pickExit(doc, step, current);
    hops.push({ stepId: step.id, blockType: step.type, transitionId: exit.id, toStepId: exit.toStepId });
    step = steps.get(exit.toStepId);
  }
  throw new InvalidStateError('The workflow points to a block that does not exist');
}

function recalculateAfter(doc: WorkflowVersionDocument, step: StepDocument, current: Record<string, unknown>, context: ComputeContext, failures: FormulaFailure[]): void {
  runCalculatorBlock(step.config as unknown as CalculatorBlockConfig, current, context, failures);
  const recomputed = computeFieldValues(doc.fields, current, context);
  for (const failure of recomputed.failures) if (current[failure.fieldCode] !== null) failures.push({ ...failure, strict: false });
  Object.assign(current, recomputed.values);
}

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function changedOf(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(after).filter(([code, value]) => !sameJson(before[code], value)));
}

function pickExit(doc: WorkflowVersionDocument, step: StepDocument, values: Readonly<Record<string, unknown>>): TransitionDocument {
  const exits = doc.transitions.filter((transition) => transition.fromStepId === step.id);
  const branch = step.type === 'CONDITION' ? exits.find((exit) => exit.type === 'CONDITION' && exit.condition !== null && evaluateConditions(exit.condition, values)) : undefined;
  const chosen = branch ?? exits.find((exit) => exit.type === 'DEFAULT');
  if (chosen === undefined) throw new NoMatchingBranchError(step.id);
  return chosen;
}
