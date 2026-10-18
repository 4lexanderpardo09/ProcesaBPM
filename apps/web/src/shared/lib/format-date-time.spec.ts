import { describe, expect, it } from 'vitest';
import { formatDateTime, formatShortDate } from './format-date-time';

describe('formatDateTime', () => {
  it('writes the date and time in Spanish in the given time zone', () => {
    const text = formatDateTime('2026-10-17T20:30:00Z', 'America/Bogota');
    expect(text).toContain('17 de octubre de 2026');
    expect(text).toMatch(/3:30/);
  });

  it('returns the input when it is not a date', () => {
    expect(formatDateTime('soon')).toBe('soon');
  });
});

describe('formatShortDate', () => {
  it('writes a short date in the given time zone', () => {
    expect(formatShortDate('2026-10-18T03:00:00Z', 'America/Bogota')).toMatch(/^17 de oct\.? de 2026$/);
  });
});
