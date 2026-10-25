import { describe, expect, it } from 'vitest';
import { rankingClassOf, rankingScore, rankPeople } from './ranking-score.js';

describe('rankingScore (the help desk formula)', () => {
  it('weights compliance 70 % and quality 30 %, then by volume and errors: 10 tickets, 8 on time, 1 error', () => {
    const result = rankingScore({ delivered: 10, handled: 10, onTime: 8, late: 2, errors: 1 });
    expect(result).toMatchObject({ compliance: 0.8, quality: 0.9, score: 83 });
    // 83 × ln(11) × 0.9² = 83 × 2.3979 × 0.81
    expect(result.weighted).toBeCloseTo(161.2105, 3);
  });

  it('counts compliance over every step held (each clock), not only the ones with a deadline', () => {
    expect(rankingScore({ delivered: 3, handled: 4, onTime: 2, late: 0, errors: 0 })).toMatchObject({ compliance: 0.5, quality: 1, score: 65 });
  });

  it('rewards volume: the same record over more tickets weighs more', () => {
    const few = rankingScore({ delivered: 2, handled: 2, onTime: 2, late: 0, errors: 0 }).weighted!;
    const many = rankingScore({ delivered: 20, handled: 20, onTime: 20, late: 0, errors: 0 }).weighted!;
    expect(many).toBeGreaterThan(few);
  });

  it('has no score without tickets', () => {
    expect(rankingScore({ delivered: 0, handled: 0, onTime: 0, late: 0, errors: 0 })).toEqual({ compliance: null, quality: null, score: null, weighted: null });
  });
});

describe('rankingClassOf', () => {
  it('colors against the best of the period: 80 % green, 55 % yellow, below red', () => {
    expect(rankingClassOf(100, 100)).toBe('GREEN');
    expect(rankingClassOf(80, 100)).toBe('GREEN');
    expect(rankingClassOf(79.9, 100)).toBe('YELLOW');
    expect(rankingClassOf(55, 100)).toBe('YELLOW');
    expect(rankingClassOf(54.9, 100)).toBe('RED');
    expect(rankingClassOf(0, 0)).toBe('RED');
  });
});

describe('rankPeople', () => {
  const person = (userId: string, handled: number, onTime: number, late: number, errors = 0, medianMin: number | null = 100) => ({ userId, delivered: handled, handled, onTime, late, errors, medianMin });

  it('orders by the weighted score, numbers from 1 and colors each against the first', () => {
    const { ranked } = rankPeople([person('few', 2, 2, 0), person('many', 20, 18, 2), person('sloppy', 20, 20, 0, 6)], 1);
    expect(ranked.map((p) => [p.userId, p.rank])).toEqual([['many', 1], ['sloppy', 2], ['few', 3]]);
    expect(ranked[0]!.classification).toBe('GREEN');
    expect(ranked.at(-1)!.classification).toBe('RED');
  });

  it('breaks ties by volume, then speed, then id', () => {
    const { ranked } = rankPeople([person('d', 10, 10, 0), person('b', 10, 10, 0, 0, 50)], 1);
    expect(ranked.map((p) => p.userId)).toEqual(['b', 'd']);
  });

  it('keeps people below the minimum volume, or without tickets, out of the ranking', () => {
    const { ranked, unranked } = rankPeople([person('few', 2, 2, 0), person('none', 0, 0, 0, 1), person('ok', 9, 9, 0)], 5);
    expect(ranked.map((p) => p.userId)).toEqual(['ok']);
    expect(unranked.map((p) => [p.userId, p.classification])).toEqual([['few', null], ['none', null]]);
  });
});
