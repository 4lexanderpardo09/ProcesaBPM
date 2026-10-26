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


/** A person asked to sign a PARALLEL step, for one of its signer rows (`null`: added by hand on reassignment). */
export interface SignerAssignment {
  readonly userId: string;
  readonly signerId: string | null;
}

/** A signature of the previous round of the step. */
export interface PreviousSignature extends SignerAssignment {
  readonly status: ParallelStatus;
  readonly completedAt: Date | null;
  readonly comment: string | null;
}

export interface SignatureRound {
  /** Signatures still to give. */
  readonly pending: readonly SignerAssignment[];
  /** Signatures of the previous round that stand (copied as SIGNED, with their date and comment). */
  readonly kept: readonly PreviousSignature[];
}

/**
 * The signatures a PARALLEL step asks for when the ticket arrives. As in the help desk, a round that ended because
 * somebody rejected is not started from scratch: who had already signed for an area stays signed, and only the
 * rejected and the missing signatures are asked again. Any other way back (a later step returning the ticket) starts a
 * full round, as something may have changed. A signature stands for its signer row; one without a row stands for the
 * same person. If nothing would be left to sign, the round starts in full.
 */
export function signatureRound(assignments: readonly SignerAssignment[], previous: readonly PreviousSignature[]): SignatureRound {
  if (!previous.some((signature) => signature.status === 'REJECTED')) return { pending: assignments, kept: [] };
  const signed = previous.filter((signature) => signature.status === 'SIGNED');
  const standing = (assignment: SignerAssignment) =>
    signed.find((signature) => (assignment.signerId !== null && signature.signerId !== null ? signature.signerId === assignment.signerId : signature.userId === assignment.userId));
  const kept: PreviousSignature[] = [];
  const pending: SignerAssignment[] = [];
  for (const assignment of assignments) {
    const signature = standing(assignment);
    if (signature === undefined) pending.push(assignment);
    else if (!kept.includes(signature)) kept.push(signature);
  }
  // Somebody who already signed is not asked again for another row.
  const keptPeople = new Set(kept.map((signature) => signature.userId));
  const stillPending = pending.filter((assignment) => !keptPeople.has(assignment.userId));
  return stillPending.length === 0 ? { pending: assignments, kept: [] } : { pending: stillPending, kept };
}
