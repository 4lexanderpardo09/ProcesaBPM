import { type RuleContext } from './context.js';

/** The graph as a whole: where it starts and ends, and that every block takes part in it. */
export function checkStructure({ doc, graph, problems, reachable, canFinish, transitionsFrom }: RuleContext): void {
  const hasStart = graph.starts.length > 0;
  const hasEnd = graph.ends.length > 0;
  if (!hasStart) problems.error('NO_START');
  if (!hasEnd) problems.error('NO_END');
  if (hasStart && hasEnd && !graph.ends.some((end) => reachable.has(end))) problems.error('END_NOT_REACHABLE');

  for (const step of doc.steps) {
    if (hasStart && !reachable.has(step.id)) problems.error('BLOCK_UNREACHABLE', { stepId: step.id });
    if (step.type === 'END') continue;
    if ((transitionsFrom.get(step.id) ?? []).length === 0) problems.error('DEAD_END_BLOCK', { stepId: step.id });
    else if (hasEnd && !canFinish.has(step.id)) problems.error('BLOCK_CANNOT_REACH_END', { stepId: step.id });
  }

  const seen = new Map<string, string>();
  for (const step of doc.steps) {
    const key = step.name.trim().toLowerCase();
    if (seen.has(key)) problems.error('STEP_NAME_DUPLICATE', { stepId: step.id, params: { name: step.name } });
    else seen.set(key, step.id);
  }
}
