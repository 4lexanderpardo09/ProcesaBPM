import { describe, expect, it } from 'vitest';
import { calendarYearIn } from './tenant-signup-policy.js';

describe('calendarYearIn', () => {
  it('follows the time zone around New Year', () => {
    const instant = new Date('2027-01-01T03:00:00Z');
    expect(calendarYearIn('America/Bogota', instant)).toBe(2026);
    expect(calendarYearIn('Europe/Madrid', instant)).toBe(2027);
  });
});
