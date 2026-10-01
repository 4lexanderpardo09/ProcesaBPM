import { InvalidStateError, type TransitionDocument, type WorkflowVersionDocument } from '@procesabpm/shared';

export type ParallelStatus = 'PENDING' | 'SIGNED' | 'REJECTED' | 'CANCELLED';

export interface ParallelExits {
  /** The way out when everybody signed: the step's only DECISION. */
  readonly approval: TransitionDocument;
  /** The way out when somebody rejects: the step's SYSTEM_ONLY transition, if it has one. */
  readonly rejection: TransitionDocument | null;
}

export function parallelExits(document: WorkflowVersionDocument, stepId: string): ParallelExits {
  const exits = document.transitions.filter((transition) => transition.fromStepId === stepId);
  const decisions = exits.filter((exit) => exit.type === 'DECISION');
  if (decisions.length !== 1) throw new InvalidStateError('A parallel step must have exactly one DECISION way out');
  return { approval: decisions[0]!, rejection: exits.find((exit) => exit.type === 'SYSTEM_ONLY') ?? null };
}

export type ParallelOutcome = { readonly kind: 'WAIT' } | { readonly kind: 'APPROVED' } | { readonly kind: 'REJECTED'; readonly cancelUserIds: readonly string[] };

/**
 * What a signature does to the step: everybody must sign, so the last pending signature approves; the first
 * rejection decides at once and cancels the signatures still pending.
 */
export function parallelOutcome(tasks: ReadonlyArray<{ readonly userId: string; readonly status: ParallelStatus }>, actorId: string, action: 'SIGN' | 'REJECT'): ParallelOutcome {
  const othersPending = tasks.filter((task) => task.status === 'PENDING' && task.userId !== actorId).map((task) => task.userId);
  if (action === 'REJECT') return { kind: 'REJECTED', cancelUserIds: othersPending };
  return othersPending.length === 0 ? { kind: 'APPROVED' } : { kind: 'WAIT' };
}

/** Among the people who could sign for a position, the one with the fewest tickets right now; ties go to the lowest id. */
export function pickSignerHolder(holders: readonly string[], loads: ReadonlyMap<string, number>): string {
  const sorted = [...holders].sort();
  return sorted.reduce((best, candidate) => ((loads.get(candidate) ?? 0) < (loads.get(best) ?? 0) ? candidate : best), sorted[0]!);
}
