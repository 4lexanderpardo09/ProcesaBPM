/** A ticket waiting for dispatch, as far as choosing its person goes. */
export interface DispatchCandidateTicket {
  readonly id: string;
  /** Set when it was answered in a batch: the whole batch goes to one person. */
  readonly batchId: string | null;
}

export interface DispatchPlanInput<T extends DispatchCandidateTicket> {
  /** Oldest first; all of them with the same people to choose from. */
  readonly tickets: readonly T[];
  readonly candidateIds: readonly string[];
  /** Open tickets each candidate already holds in the step: what they still have to do. */
  readonly load: ReadonlyMap<string, number>;
  /** Who already holds part of a batch in the step (the rest of it arrived in an earlier run): the rest goes to them. */
  readonly batchHolders: ReadonlyMap<string, string>;
  readonly random?: () => number;
}

/**
 * Balanced dispatch, as the help desk does it: tickets answered together in a batch stay together; each batch (or
 * single ticket) goes to the candidate with the fewest open tickets in the step, counting what this run already gave;
 * bigger batches go first so the singles even it out, and ties are drawn at random.
 */
export function planDispatch<T extends DispatchCandidateTicket>({ tickets, candidateIds, load, batchHolders, random = Math.random }: DispatchPlanInput<T>): Array<{ readonly ticket: T; readonly userId: string }> {
  const people = [...new Set(candidateIds)];
  if (people.length === 0) return [];
  const given = new Map(people.map((id) => [id, load.get(id) ?? 0]));
  // A stable sort keeps the shuffled order among units of the same size.
  const units = shuffle(unitsOf(tickets), random).sort((a, b) => b.length - a.length);
  const plan: Array<{ ticket: T; userId: string }> = [];
  for (const unit of units) {
    const batchId = unit[0]!.batchId;
    const holder = batchId === null ? undefined : batchHolders.get(batchId);
    const userId = holder !== undefined && given.has(holder) ? holder : leastLoaded(given, random);
    given.set(userId, given.get(userId)! + unit.length);
    for (const ticket of unit) plan.push({ ticket, userId });
  }
  return plan;
}

/** The tickets of each batch together, in their order; the others one by one. */
function unitsOf<T extends DispatchCandidateTicket>(tickets: readonly T[]): T[][] {
  const batches = new Map<string, T[]>();
  const singles: T[][] = [];
  for (const ticket of tickets) {
    if (ticket.batchId === null) singles.push([ticket]);
    else batches.set(ticket.batchId, [...(batches.get(ticket.batchId) ?? []), ticket]);
  }
  return [...batches.values(), ...singles];
}

function leastLoaded(given: ReadonlyMap<string, number>, random: () => number): string {
  const fewest = Math.min(...given.values());
  const tied = [...given].filter(([, count]) => count === fewest).map(([id]) => id);
  return tied[Math.floor(random() * tied.length)]!;
}

/** Fisher–Yates over a copy. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
