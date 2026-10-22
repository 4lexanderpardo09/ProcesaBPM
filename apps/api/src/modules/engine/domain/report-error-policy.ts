export interface VisitOfTicket {
  readonly id: string;
  readonly stepId: string;
  readonly enteredAt: Date;
  readonly exitedAt: Date | null;
}

/**
 * The visit the error is attributed to: the most recent one, before the current visit, of a step for people that was
 * left (its holders delivered it). None when the ticket came straight from its start.
 */
export function previousPeopleVisit(visits: readonly VisitOfTicket[], peopleStepIds: ReadonlySet<string>, currentVisitId: string): VisitOfTicket | undefined {
  return visits
    .filter((visit) => visit.id !== currentVisitId && visit.exitedAt !== null && peopleStepIds.has(visit.stepId))
    .sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime() || (a.id < b.id ? 1 : -1))[0];
}

export interface ReportedErrorKind {
  /** The step was done wrong: it goes back to who did it. */
  readonly isProcessError: boolean;
  /** The request cannot go on: the ticket closes, on the creator. */
  readonly forcesClose: boolean;
}

/**
 * What reporting an error does to the ticket, as the help desk did: a type that forces the close closes it; a process
 * error sends it back to the previous step and its holder, or closes it when that is the creator (nobody else to fix
 * it); any other error is only recorded.
 */
export type ErrorOutcome = { readonly kind: 'RECORD' } | { readonly kind: 'RETURN'; readonly stepId: string } | { readonly kind: 'CLOSE'; readonly forced: boolean };

export function errorOutcome(kind: ReportedErrorKind, previous: VisitOfTicket | undefined, responsibleIsCreator: boolean): ErrorOutcome {
  if (kind.forcesClose) return { kind: 'CLOSE', forced: true };
  if (!kind.isProcessError) return { kind: 'RECORD' };
  if (previous === undefined || responsibleIsCreator) return { kind: 'CLOSE', forced: false };
  return { kind: 'RETURN', stepId: previous.stepId };
}
