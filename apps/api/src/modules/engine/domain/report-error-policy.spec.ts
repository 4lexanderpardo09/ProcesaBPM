import { describe, expect, it } from 'vitest';
import { errorOutcome, previousPeopleVisit, type VisitOfTicket } from './report-error-policy.js';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 21, 15, minute));
const visit = (id: string, stepId: string, entered: number, exited: number | null): VisitOfTicket => ({ id, stepId, enteredAt: at(entered), exitedAt: exited === null ? null : at(exited) });
const PEOPLE = new Set(['review', 'approve', 'pay']);

describe('previousPeopleVisit', () => {
  it('is the most recent people step left before the current one', () => {
    const visits = [visit('v1', 'start', 0, 1), visit('v2', 'review', 1, 5), visit('v3', 'approve', 5, 9), visit('v4', 'pay', 9, null)];
    expect(previousPeopleVisit(visits, PEOPLE, 'v4')?.id).toBe('v3');
  });

  it('skips the automatic blocks and the current visit, and is none straight from the start', () => {
    expect(previousPeopleVisit([visit('v1', 'start', 0, 1), visit('v2', 'review', 1, null)], PEOPLE, 'v2')).toBeUndefined();
  });

  it('takes the latest visit when the ticket went around a loop', () => {
    const visits = [visit('v1', 'review', 0, 2), visit('v2', 'approve', 2, 4), visit('v3', 'review', 4, 6), visit('v4', 'approve', 6, null)];
    expect(previousPeopleVisit(visits, PEOPLE, 'v4')?.id).toBe('v3');
  });
});

describe('errorOutcome', () => {
  const previous = visit('v3', 'approve', 5, 9);

  it('only records an error that is neither a process error nor a forced close', () => {
    expect(errorOutcome({ isProcessError: false, forcesClose: false }, previous, false)).toEqual({ kind: 'RECORD' });
  });

  it('sends a process error back to the previous step', () => {
    expect(errorOutcome({ isProcessError: true, forcesClose: false }, previous, false)).toEqual({ kind: 'RETURN', stepId: 'approve' });
  });

  it('closes on a process error with nobody before but the creator', () => {
    expect(errorOutcome({ isProcessError: true, forcesClose: false }, undefined, true)).toEqual({ kind: 'CLOSE', forced: false });
    expect(errorOutcome({ isProcessError: true, forcesClose: false }, previous, true)).toEqual({ kind: 'CLOSE', forced: false });
  });

  it('closes, as forced, on a type that forces the close', () => {
    expect(errorOutcome({ isProcessError: false, forcesClose: true }, previous, false)).toEqual({ kind: 'CLOSE', forced: true });
  });
});
