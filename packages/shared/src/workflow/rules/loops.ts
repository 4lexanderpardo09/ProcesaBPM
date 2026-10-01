import { PEOPLE_STEP_TYPES } from '../constants.js';
import { type RuleContext } from './context.js';

/** A cycle needs a way out: a person's step in it (the engine would spin otherwise) and, ideally, a limit. */
export function checkLoops({ graph, stepById, problems }: RuleContext): void {
  for (const component of graph.loops()) {
    const steps = component.map((id) => stepById.get(id)!);
    const first = steps[0]!;
    const ids = steps.map((step) => step.id);
    if (!steps.some((step) => PEOPLE_STEP_TYPES.has(step.type))) problems.error('AUTOMATIC_LOOP', { stepId: first.id, params: { stepIds: ids } });
    if (!steps.some((step) => step.maxLoops !== null)) problems.warning('LOOP_WITHOUT_LIMIT', { stepId: first.id, params: { stepIds: ids } });
  }
}
