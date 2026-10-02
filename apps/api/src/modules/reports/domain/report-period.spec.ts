import { describe, expect, it } from 'vitest';
import { periodBounds } from './report-period.js';

describe('periodBounds', () => {
  it('widens the UTC range by the largest zone offset on both sides', () => {
    const bounds = periodBounds('2026-10-09', '2026-10-09');
    expect(bounds.coarseLow.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(bounds.coarseHigh.toISOString()).toBe('2026-10-10T14:00:00.000Z');
  });

  it('contains the whole local day in Bogotá, Madrid and Auckland', () => {
    const { coarseLow, coarseHigh } = periodBounds('2026-10-09', '2026-10-10');
    const localDay = (zoneOffsetHours: number, day: string, endExclusive: boolean) => Date.parse(`${day}T00:00:00Z`) - zoneOffsetHours * 3_600_000 + (endExclusive ? 24 * 3_600_000 : 0);
    for (const offset of [-5, 2, 13]) {
      expect(localDay(offset, '2026-10-09', false)).toBeGreaterThanOrEqual(coarseLow.getTime());
      expect(localDay(offset, '2026-10-10', true)).toBeLessThanOrEqual(coarseHigh.getTime());
    }
  });
});
