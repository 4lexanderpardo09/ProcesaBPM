/** An SLA clock that has not finished: it runs, or an incident paused it (`pausedAt`). */
export interface OpenSlaClock {
  readonly dueAt: Date | null;
  readonly pausedAt: Date | null;
}

export interface CurrentSla {
  readonly dueAt: Date;
  readonly overdue: boolean;
  readonly paused: boolean;
}

/**
 * Whether the clock went past its due date. A paused clock stopped at `pausedAt`: resuming it moves `dueAt` by the
 * paused business time, so it is late only if it already was when the incident paused it.
 */
export const isOverdue = (clock: OpenSlaClock, now: Date): boolean => clock.dueAt !== null && clock.dueAt.getTime() < (clock.pausedAt ?? now).getTime();

/**
 * The deadline of the step a ticket is on, from its open clocks (one per person responsible, or one for a pool): the
 * earliest due date wins. `null` when nothing is due: the ticket is closed, parked on a WAIT block or its step has no SLA.
 */
export function currentSla(openClocks: readonly OpenSlaClock[], now: Date): CurrentSla | null {
  const earliest = openClocks
    .filter((clock): clock is OpenSlaClock & { dueAt: Date } => clock.dueAt !== null)
    .reduce<(OpenSlaClock & { dueAt: Date }) | null>((first, clock) => (first === null || clock.dueAt < first.dueAt ? clock : first), null);
  if (earliest === null) return null;
  return { dueAt: earliest.dueAt, overdue: isOverdue(earliest, now), paused: earliest.pausedAt !== null };
}
