import { describe, expect, it } from 'vitest';
import { slaBadge } from './sla-badge';

const now = new Date('2026-10-20T12:00:00.000Z');
const sla = (dueAt: string, overrides: { overdue?: boolean; paused?: boolean } = {}) => ({ dueAt, overdue: false, paused: false, ...overrides });

describe('slaBadge', () => {
  it('shows nothing when nothing is due', () => {
    expect(slaBadge(null, now)).toBeUndefined();
  });

  it('says how long is left: on time beyond a day, due soon within one', () => {
    expect(slaBadge(sla('2026-10-21T18:30:00.000Z'), now)).toEqual({ kind: 'remaining', tone: 'ok', days: 1, hours: 6, minutes: 30 });
    expect(slaBadge(sla('2026-10-20T17:00:00.000Z'), now)).toEqual({ kind: 'remaining', tone: 'warn', days: 0, hours: 5, minutes: 0 });
  });

  it('trusts the API on overdue and paused, overdue first', () => {
    expect(slaBadge(sla('2026-10-19T12:00:00.000Z', { overdue: true, paused: true }), now)).toEqual({ kind: 'overdue', tone: 'danger' });
    expect(slaBadge(sla('2026-10-25T12:00:00.000Z', { paused: true }), now)).toEqual({ kind: 'paused', tone: 'warn' });
  });

  it('never counts below zero while the API has not marked it overdue yet', () => {
    expect(slaBadge(sla('2026-10-20T11:59:00.000Z'), now)).toMatchObject({ kind: 'remaining', days: 0, hours: 0, minutes: 0 });
  });
});
