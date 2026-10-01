import {
  type AssigneeCandidate,
  AssigneeSelectionRequiredError,
  type AssignmentMode,
  InvalidAssigneeError,
  InvalidStateError,
  NoAssigneeCandidatesError,
  NotImplementedError,
} from '@procesabpm/shared';

export interface AssignmentInput {
  readonly stepId: string;
  readonly mode: AssignmentMode;
  readonly manualSelection: boolean;
  /** Eligible people (active, company and site already applied), without duplicates. */
  readonly candidates: readonly AssigneeCandidate[];
  /** The person the client chose, if any. */
  readonly chosenId: string | undefined;
}

export interface AssigneeDecision {
  /** `POOL`: everybody listed may take the ticket; the first to act gets it. `DISPATCH`: nobody yet, the worker hands it out. */
  readonly type: 'PRIMARY' | 'POOL' | 'DISPATCH';
  readonly userIds: readonly string[];
}

const AUTOMATIC_MODES: ReadonlySet<AssignmentMode> = new Set(['CREATOR', 'APPROVER']);

/**
 * Who gets a step. Pure: the candidates are resolved elsewhere; this only applies the rules of the mode.
 * Several candidates without manual selection become a pool (an arbitrary pick would be unfair); with
 * manual selection the client must choose, and the choice has to be one of the candidates.
 */
export function decideAssignees(input: AssignmentInput): AssigneeDecision {
  const { stepId, mode, candidates } = input;
  if (mode === 'PARALLEL') throw new NotImplementedError(`${mode} assignment: a parallel step resolves its signers, not candidates`);
  if (mode === 'NONE') throw new InvalidStateError('An automatic block has no assignee');
  if (candidates.length === 0) throw new NoAssigneeCandidatesError(stepId, mode);
  const everyone = candidates.map((candidate) => candidate.userId);

  if (mode === 'RANDOM_DISPATCH') return { type: 'DISPATCH', userIds: [] };
  if (AUTOMATIC_MODES.has(mode)) return { type: 'PRIMARY', userIds: [everyone[0]!] };
  if (mode === 'POOL') return { type: 'POOL', userIds: everyone };
  if (input.manualSelection) {
    if (input.chosenId !== undefined) {
      if (!everyone.includes(input.chosenId)) throw new InvalidAssigneeError();
      return { type: 'PRIMARY', userIds: [input.chosenId] };
    }
    if (candidates.length > 1) throw new AssigneeSelectionRequiredError(stepId, candidates);
  }
  return candidates.length === 1 ? { type: 'PRIMARY', userIds: everyone } : { type: 'POOL', userIds: everyone };
}
