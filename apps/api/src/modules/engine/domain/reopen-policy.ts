import { InvalidReopenStepError } from '@procesabpm/shared';

export interface VisitSummary {
  readonly id: string;
  readonly stepId: string;
  readonly enteredAt: Date;
}

/**
 * The step a closed ticket is reopened into: one it has been through (and that still is a step for people), by
 * default the one of its most recent visit. A ticket that went from START to END without a person has none.
 */
export function reopenTarget(visits: readonly VisitSummary[], peopleStepIds: ReadonlySet<string>, requested?: string): string {
  const visited = visits.filter((visit) => peopleStepIds.has(visit.stepId));
  if (requested !== undefined) {
    if (!visited.some((visit) => visit.stepId === requested)) throw new InvalidReopenStepError();
    return requested;
  }
  const last = [...visited].sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime() || (a.id < b.id ? 1 : -1))[0];
  if (last === undefined) throw new InvalidReopenStepError();
  return last.stepId;
}

/** Who held the step when the ticket closed: the responsibles of the clocks that ended with the visit. */
export function lastHolders(clocks: ReadonlyArray<{ readonly responsibleId: string | null; readonly completedAt: Date | null }>, exitedAt: Date | null): string[] {
  if (exitedAt === null) return [];
  const ids = clocks.filter((clock) => clock.responsibleId !== null && clock.completedAt?.getTime() === exitedAt.getTime()).map((clock) => clock.responsibleId!);
  return [...new Set(ids)].sort();
}

/** Reopening starts a new visit: the loop continues counting, and `max_loops` does not apply to a deliberate reopening. */
export const nextReopenLoop = (loops: readonly number[]): number => (loops.length === 0 ? 1 : Math.max(...loops) + 1);
