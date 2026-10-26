import { describe, expect, it } from 'vitest';
import { tripDaysBetween } from './StepFieldInput';

describe('tripDaysBetween', () => {
  it('lists every local day from the departure to the return, both included', () => {
    expect(tripDaysBetween('2026-11-10T06:30', '2026-11-12T20:00')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(tripDaysBetween('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('is empty while a date is missing or the trip ends before it starts, and stops at 92 days', () => {
    expect(tripDaysBetween('', '2026-11-12')).toEqual([]);
    expect(tripDaysBetween('2026-11-12', '2026-11-10')).toEqual([]);
    expect(tripDaysBetween(['x'], '2026-11-10')).toEqual([]);
    expect(tripDaysBetween('2026-01-01', '2026-12-31')).toHaveLength(92);
  });
});
