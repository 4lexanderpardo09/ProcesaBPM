import { describe, expect, it } from 'vitest';
import { rankingScore, rankPeople } from './ranking-score.js';

describe('rankingScore', () => {
  it('multiplies compliance by quality: 8 on time, 2 late, 10 tickets, 1 error is 72.0', () => {
    expect(rankingScore({ delivered: 10, onTime: 8, late: 2, errors: 1 })).toEqual({ compliance: 0.8, quality: 0.9, score: 72 });
  });

  it('quality never goes below zero', () => {
    expect(rankingScore({ delivered: 2, onTime: 2, late: 0, errors: 5 })).toMatchObject({ quality: 0, score: 0 });
  });

  it('has no score without a judged clock or without tickets', () => {
    expect(rankingScore({ delivered: 3, onTime: 0, late: 0, errors: 0 })).toEqual({ compliance: null, quality: 1, score: null });
    expect(rankingScore({ delivered: 0, onTime: 0, late: 0, errors: 0 }).score).toBeNull();
  });
});

describe('rankPeople', () => {
  const person = (userId: string, delivered: number, onTime: number, late: number, errors = 0, medianMin: number | null = 100) => ({ userId, delivered, onTime, late, errors, medianMin });

  it('orders by score, then volume, then speed, then id, and numbers from 1', () => {
    const { ranked } = rankPeople([person('d', 10, 10, 0), person('c', 20, 10, 0), person('b', 10, 10, 0, 0, 50), person('a', 10, 5, 5)], 5);
    expect(ranked.map((p) => [p.userId, p.rank])).toEqual([['c', 1], ['b', 2], ['d', 3], ['a', 4]]);
  });

  it('keeps people below the minimum volume, or without a score, out of the ranking', () => {
    const { ranked, unranked } = rankPeople([person('few', 2, 2, 0), person('none', 9, 0, 0), person('ok', 9, 9, 0)], 5);
    expect(ranked.map((p) => p.userId)).toEqual(['ok']);
    expect(unranked.map((p) => p.userId)).toEqual(['few', 'none']);
  });
});
