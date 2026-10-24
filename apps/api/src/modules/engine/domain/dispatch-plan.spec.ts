import { describe, expect, it } from 'vitest';
import { planDispatch } from './dispatch-plan.js';

const single = (id: string) => ({ id, batchId: null });
const inBatch = (id: string, batchId: string) => ({ id, batchId });
const owners = (plan: ReturnType<typeof planDispatch>) => Object.fromEntries(plan.map(({ ticket, userId }) => [ticket.id, userId]));
const countsOf = (plan: ReturnType<typeof planDispatch>) => plan.reduce<Record<string, number>>((all, { userId }) => ({ ...all, [userId]: (all[userId] ?? 0) + 1 }), {});
const noLoad = new Map<string, number>();
const noHolders = new Map<string, string>();
/** Always the first of a draw: ties go to the first candidate. */
const first = () => 0;

describe('planDispatch', () => {
  it('gives each ticket to whoever holds the fewest open tickets in the step, counting what it already gave', () => {
    const plan = planDispatch({ tickets: ['t1', 't2', 't3'].map(single), candidateIds: ['ana', 'bea'], load: new Map([['ana', 2]]), batchHolders: noHolders, random: first });
    expect(countsOf(plan)).toEqual({ bea: 2, ana: 1 });
  });

  it('sends a batch whole to one person, and the bigger batches first so the singles even it out', () => {
    const tickets = [single('s1'), inBatch('a1', 'A'), inBatch('a2', 'A'), inBatch('a3', 'A'), single('s2'), single('s3')];
    const plan = planDispatch({ tickets, candidateIds: ['ana', 'bea'], load: noLoad, batchHolders: noHolders, random: first });
    const byTicket = owners(plan);
    expect(new Set([byTicket.a1, byTicket.a2, byTicket.a3]).size).toBe(1);
    expect(plan.slice(0, 3).map(({ ticket }) => ticket.id)).toEqual(['a1', 'a2', 'a3']);
    const batchOwner = byTicket.a1;
    expect([byTicket.s1, byTicket.s2, byTicket.s3].every((owner) => owner !== batchOwner)).toBe(true);
  });

  it('gives the rest of a batch to whoever already holds part of it, if they can still take it', () => {
    const tickets = [inBatch('a4', 'A'), inBatch('b1', 'B')];
    const plan = planDispatch({ tickets, candidateIds: ['ana', 'bea'], load: new Map([['bea', 5]]), batchHolders: new Map([['A', 'bea'], ['B', 'gone']]), random: first });
    expect(owners(plan)).toEqual({ a4: 'bea', b1: 'ana' });
  });

  it('draws ties at random', () => {
    const draw = (value: number) => owners(planDispatch({ tickets: [single('t1')], candidateIds: ['ana', 'bea', 'cris'], load: noLoad, batchHolders: noHolders, random: () => value }));
    expect(draw(0)).toEqual({ t1: 'ana' });
    expect(draw(0.5)).toEqual({ t1: 'bea' });
    expect(draw(0.99)).toEqual({ t1: 'cris' });
  });

  it('spreads many singles evenly', () => {
    const tickets = Array.from({ length: 30 }, (_, index) => single(`t${index}`));
    const plan = planDispatch({ tickets, candidateIds: ['ana', 'bea', 'cris'], load: noLoad, batchHolders: noHolders });
    expect(countsOf(plan)).toEqual({ ana: 10, bea: 10, cris: 10 });
  });

  it('plans nothing without candidates, and counts a repeated candidate once', () => {
    expect(planDispatch({ tickets: [single('t1')], candidateIds: [], load: noLoad, batchHolders: noHolders })).toEqual([]);
    const plan = planDispatch({ tickets: ['t1', 't2'].map(single), candidateIds: ['ana', 'ana', 'bea'], load: noLoad, batchHolders: noHolders, random: first });
    expect(countsOf(plan)).toEqual({ ana: 1, bea: 1 });
  });
});
