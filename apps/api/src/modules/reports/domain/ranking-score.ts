/** One person's counts for the period. */
export interface RankingInput {
  /** Tickets they delivered (distinct) in the period. */
  readonly delivered: number;
  /** Times they held a step (each of their clocks), as the help desk counts each assignment: the n of the formula. */
  readonly handled: number;
  readonly onTime: number;
  readonly late: number;
  /** Process errors blamed on them (an error type marked as a process error, or one that forces the close). */
  readonly errors: number;
}

export type RankingClass = 'GREEN' | 'YELLOW' | 'RED';

export interface RankingScore {
  /** On time over everything handled. */
  readonly compliance: number | null;
  /** 1 − process errors over everything handled. */
  readonly quality: number | null;
  /** 0.7 × compliance + 0.3 × quality, out of 100. */
  readonly score: number | null;
  /** The score weighted by volume and errors: what the ranking orders by. */
  readonly weighted: number | null;
}

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

/**
 * The help desk's ranking (decision B5): with n handled (each time the person held a step), e process errors and o on time,
 * score = 70 × o/n + 30 × (1 − e/n) and weighted = score × ln(n + 1) × (1 − e/n)². The logarithm rewards volume and the
 * square punishes errors twice; nobody without tickets has a score.
 */
export function rankingScore({ handled, onTime, errors }: RankingInput): RankingScore {
  if (handled === 0) return { compliance: null, quality: null, score: null, weighted: null };
  const compliance = onTime / handled;
  const quality = 1 - errors / handled;
  const score = round(70 * compliance + 30 * quality, 1);
  return { compliance, quality, score, weighted: round(score * Math.log(handled + 1) * (1 - errors / handled) ** 2, 4) };
}

/** Against the best of the period, as the help desk colors it: from 80 % green, from 55 % yellow, below red. */
export function rankingClassOf(weighted: number, best: number): RankingClass {
  const share = best <= 0 ? 0 : (weighted / best) * 100;
  return share >= 80 ? 'GREEN' : share >= 55 ? 'YELLOW' : 'RED';
}

export interface Rankable extends RankingInput {
  readonly userId: string;
  readonly medianMin: number | null;
}

type WithScore<T> = T & RankingScore & { readonly classification: RankingClass | null };

/** Splits people into the ranked (enough volume and a score), by weighted score, and the rest. Ties: more handled, faster median, then id. */
export function rankPeople<T extends Rankable>(people: readonly T[], minVolume: number): { ranked: Array<WithScore<T> & { rank: number }>; unranked: Array<WithScore<T>> } {
  const scored = people.map((person) => ({ ...person, ...rankingScore(person) }));
  const eligible = scored.filter((person) => person.handled >= minVolume && person.weighted !== null);
  eligible.sort((a, b) => b.weighted! - a.weighted! || b.handled - a.handled || (a.medianMin ?? Infinity) - (b.medianMin ?? Infinity) || a.userId.localeCompare(b.userId));
  const best = eligible[0]?.weighted ?? 0;
  const rest = scored.filter((person) => !eligible.includes(person)).sort((a, b) => a.userId.localeCompare(b.userId));
  return {
    ranked: eligible.map((person, index) => ({ ...person, classification: rankingClassOf(person.weighted!, best), rank: index + 1 })),
    unranked: rest.map((person) => ({ ...person, classification: null })),
  };
}
