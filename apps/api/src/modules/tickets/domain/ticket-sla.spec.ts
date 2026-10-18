import { describe, expect, it } from 'vitest';
import { currentSla, isOverdue } from './ticket-sla.js';

const now = new Date('2026-10-18T12:00:00.000Z');
const at = (iso: string) => new Date(`2026-10-18T${iso}:00.000Z`);

describe('isOverdue', () => {
  it('a running clock is late once its due date has passed', () => {
    expect(isOverdue({ dueAt: at('11:59'), pausedAt: null }, now)).toBe(true);
    expect(isOverdue({ dueAt: at('12:01'), pausedAt: null }, now)).toBe(false);
  });

  it('a clock without SLA is never late', () => expect(isOverdue({ dueAt: null, pausedAt: null }, now)).toBe(false));

  it('a paused clock is late only if it already was when it was paused', () => {
    expect(isOverdue({ dueAt: at('10:00'), pausedAt: at('11:00') }, now)).toBe(true);
    expect(isOverdue({ dueAt: at('11:00'), pausedAt: at('10:00') }, now)).toBe(false);
  });
});

describe('currentSla', () => {
  it('is null when no open clock has a due date (closed, WAIT or a step without SLA)', () => {
    expect(currentSla([], now)).toBeNull();
    expect(currentSla([{ dueAt: null, pausedAt: null }], now)).toBeNull();
  });

  it('takes the earliest due date among the open clocks', () => {
    const sla = currentSla([{ dueAt: at('15:00'), pausedAt: null }, { dueAt: null, pausedAt: null }, { dueAt: at('11:00'), pausedAt: null }], now);
    expect(sla).toEqual({ dueAt: at('11:00'), overdue: true, paused: false });
  });

  it('reports a clock paused by an incident', () => {
    expect(currentSla([{ dueAt: at('14:00'), pausedAt: at('09:00') }], now)).toEqual({ dueAt: at('14:00'), overdue: false, paused: true });
  });
});
