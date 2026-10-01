import { InvalidStateError } from '@procesabpm/shared';

export type CancellationAction = 'DELETE' | 'END_NOW';

/**
 * Cancelling a delegation that has not started removes it; one in force ends now (what was decided
 * under it keeps its history); one that already ended cannot be cancelled.
 */
export function cancellationOf(delegation: { startsAt: Date; endsAt: Date }, now: Date): CancellationAction {
  if (delegation.endsAt <= now) throw new InvalidStateError('The delegation has already ended');
  return delegation.startsAt > now ? 'DELETE' : 'END_NOW';
}
