import { MaxLoopsReachedError } from '@procesabpm/shared';

/** The loop number of the next visit to a step, refusing it when the step's `max_loops` would be exceeded. */
export function nextLoop(previousLoops: readonly number[], maxLoops: number | null, stepId: string): number {
  const loop = previousLoops.length === 0 ? 1 : Math.max(...previousLoops) + 1;
  if (maxLoops !== null && loop > maxLoops) throw new MaxLoopsReachedError(stepId, maxLoops);
  return loop;
}
