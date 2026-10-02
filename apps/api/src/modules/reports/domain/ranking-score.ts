/** One person's counts for the period. */
export interface RankingInput {
  /** Tickets they handled (distinct) in the period. */
  readonly delivered: number;
  readonly onTime: number;
  readonly late: number;
  /** Reopenings blamed on them. */
  readonly errors: number;
}

export interface RankingScore {
  readonly compliance: number | null;
  readonly quality: number | null;
  readonly score: number | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * score = 100 × C × Q, where C = on time / (on time + late) and Q = max(0, 1 − errors / delivered).
 * Nobody with no clock that had an SLA has a compliance, and nobody without a compliance has a score.
 */
export function rankingScore({ delivered, onTime, late, errors }: RankingInput): RankingScore {
  const judged = onTime + late;
  const compliance = judged === 0 ? null : onTime / judged;
  const quality = delivered === 0 ? null : Math.max(0, 1 - errors / delivered);
  return { compliance, quality, score: compliance === null || quality === null ? null : round1(100 * compliance * quality) };
}

export interface Rankable extends RankingInput {
  readonly userId: string;
  readonly medianMin: number | null;
}

type WithScore<T> = T & RankingScore;

/** Splits people into the ranked (enough volume and a score), in order, and the rest. Ties: more delivered, faster median, then id. */
export function rankPeople<T extends Rankable>(people: readonly T[], minVolume: number): { ranked: Array<WithScore<T> & { rank: number }>; unranked: Array<WithScore<T>> } {
  const scored = people.map((person): WithScore<T> => ({ ...person, ...rankingScore(person) }));
  const eligible = scored.filter((person) => person.delivered >= minVolume && person.score !== null);
  eligible.sort((a, b) => b.score! - a.score! || b.delivered - a.delivered || (a.medianMin ?? Infinity) - (b.medianMin ?? Infinity) || a.userId.localeCompare(b.userId));
  const rest = scored.filter((person) => !eligible.includes(person)).sort((a, b) => a.userId.localeCompare(b.userId));
  return { ranked: eligible.map((person, index) => ({ ...person, rank: index + 1 })), unranked: rest };
}
