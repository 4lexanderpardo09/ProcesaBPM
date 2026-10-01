import { isAutomaticStep } from '../constants.js';
import { WorkflowGraph } from '../graph.js';
import { type RuleContext } from './context.js';

/** A cycle needs a person's step in it (the engine would spin otherwise) and, ideally, a limit (`max_loops`). */
export function checkLoops({ doc, graph, stepById, problems }: RuleContext): void {
  // A cycle made only of automatic blocks never waits for anybody, even inside a bigger loop that has people in it.
  const automatic = new Set(doc.steps.filter((step) => isAutomaticStep(step.type)).map((step) => step.id));
  const automaticGraph = new WorkflowGraph(
    doc.steps.filter((step) => automatic.has(step.id)).map((step) => ({ id: step.id, type: step.type })),
    doc.transitions.filter((transition) => automatic.has(transition.fromStepId) && automatic.has(transition.toStepId)).map((transition) => ({ from: transition.fromStepId, to: transition.toStepId })),
  );
  for (const component of automaticGraph.loops()) problems.error('AUTOMATIC_LOOP', { stepId: component[0]!, params: { stepIds: component } });

  for (const component of graph.loops()) {
    const steps = component.map((id) => stepById.get(id)!);
    const first = steps[0]!;
    const ids = steps.map((step) => step.id);
    if (!steps.some((step) => step.maxLoops !== null)) problems.warning('LOOP_WITHOUT_LIMIT', { stepId: first.id, params: { stepIds: ids } });
  }
}
