import { InvalidReopenStepError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { lastHolders, nextReopenLoop, reopenTarget } from './reopen-policy.js';

const visit = (id: string, stepId: string, minute: number) => ({ id, stepId, enteredAt: new Date(2026, 8, 7, 9, minute) });
const people = new Set(['a', 'b']);

describe('reopenTarget', () => {
  const visits = [visit('1', 'a', 0), visit('2', 'b', 10), visit('3', 'auto', 20)];
  it('defaults to the most recent step for people', () => expect(reopenTarget(visits, people)).toBe('b'));
  it('accepts a step it has been through', () => expect(reopenTarget(visits, people, 'a')).toBe('a'));
  it('refuses a step it has not been through, or one that is not for people', () => {
    expect(() => reopenTarget(visits, people, 'zzz')).toThrow(InvalidReopenStepError);
    expect(() => reopenTarget(visits, people, 'auto')).toThrow(InvalidReopenStepError);
  });
  it('refuses a ticket that never had a person step', () => expect(() => reopenTarget([], people)).toThrow(InvalidReopenStepError));
  it('breaks a tie by id', () => expect(reopenTarget([visit('1', 'a', 5), visit('2', 'b', 5)], people)).toBe('b'));
});

describe('lastHolders', () => {
  const closedAt = new Date(2026, 8, 7, 12);
  it('takes the responsibles of the clocks that ended with the visit, once each', () => {
    const clocks = [
      { responsibleId: 'u2', completedAt: closedAt },
      { responsibleId: 'u1', completedAt: closedAt },
      { responsibleId: 'u1', completedAt: closedAt },
      { responsibleId: 'old', completedAt: new Date(2026, 8, 7, 10) },
      { responsibleId: null, completedAt: closedAt },
    ];
    expect(lastHolders(clocks, closedAt)).toEqual(['u1', 'u2']);
  });
  it('is empty when the visit never ended', () => expect(lastHolders([{ responsibleId: 'u', completedAt: closedAt }], null)).toEqual([]));
});

describe('nextReopenLoop', () => {
  it('continues the count', () => {
    expect(nextReopenLoop([])).toBe(1);
    expect(nextReopenLoop([1, 3])).toBe(4);
  });
});
