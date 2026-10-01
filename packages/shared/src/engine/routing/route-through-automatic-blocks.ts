import { InvalidStateError, NoMatchingBranchError, NotImplementedError } from '../../errors/domain-error.js';
import { PEOPLE_STEP_TYPES, type StepType } from '../../workflow/constants.js';
import type { StepDocument, TransitionDocument, WorkflowVersionDocument } from '../../workflow/document.js';
import { evaluateConditions } from '../conditions/evaluate-conditions.js';

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
}

/**
 * Follows the automatic blocks from `entryStepId` until the ticket reaches a people step or the end. Pure:
 * CONDITION blocks take the first branch (in canvas order) whose rule holds, else their DEFAULT; the others
 * take their DEFAULT. A WAIT or CALCULATOR block stops the whole operation: it is not implemented, so the
 * ticket never silently skips it.
 */
export function routeThroughAutomaticBlocks(doc: WorkflowVersionDocument, entryStepId: string, values: Readonly<Record<string, unknown>>): RouteResult {
  const steps = new Map<string, StepDocument>(doc.steps.map((step) => [step.id, step]));
  const hops: RouteHop[] = [];
  let current = steps.get(entryStepId);
  while (current !== undefined) {
    if (current.type === 'END') return { hops, arrival: { stepId: current.id, kind: 'END' } };
    if (PEOPLE_STEP_TYPES.has(current.type)) return { hops, arrival: { stepId: current.id, kind: 'PEOPLE' } };
    if (current.type === 'WAIT' || current.type === 'CALCULATOR') throw new NotImplementedError(`${current.type} blocks`);
    if (hops.length >= MAX_HOPS) throw new InvalidStateError('The workflow loops through automatic blocks without reaching a person');
    const exit = pickExit(doc, current, values);
    hops.push({ stepId: current.id, blockType: current.type, transitionId: exit.id, toStepId: exit.toStepId });
    current = steps.get(exit.toStepId);
  }
  throw new InvalidStateError('The workflow points to a block that does not exist');
}

function pickExit(doc: WorkflowVersionDocument, step: StepDocument, values: Readonly<Record<string, unknown>>): TransitionDocument {
  const exits = doc.transitions.filter((transition) => transition.fromStepId === step.id);
  const branch = step.type === 'CONDITION' ? exits.find((exit) => exit.type === 'CONDITION' && exit.condition !== null && evaluateConditions(exit.condition, values)) : undefined;
  const chosen = branch ?? exits.find((exit) => exit.type === 'DEFAULT');
  if (chosen === undefined) throw new NoMatchingBranchError(step.id);
  return chosen;
}
