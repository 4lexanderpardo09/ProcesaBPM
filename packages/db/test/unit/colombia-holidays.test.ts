import { describe, expect, it } from 'vitest';
import { colombianHolidays, easterSunday } from '../../src/holidays/colombia.js';

/** Lists maintained by hand in the legacy system (help-desk-backend date.helper.ts). */
const LEGACY_LISTS: Record<number, string[]> = {
  2025: [
    '2025-01-01', '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-05-01', '2025-06-02', '2025-06-23',
    '2025-06-30', '2025-07-20', '2025-08-07', '2025-08-18', '2025-10-13', '2025-11-03', '2025-11-17', '2025-12-08',
    '2025-12-25',
  ],
  2026: [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
    '2026-06-15', '2026-06-29', '2026-07-13', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
    '2026-11-16', '2026-12-08', '2026-12-25',
  ],
  2027: [
    '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10', '2027-05-31',
    '2027-06-07', '2027-07-05', '2027-07-12', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01',
    '2027-11-15', '2027-12-08', '2027-12-25',
  ],
};

describe('colombianHolidays', () => {
  it.each(Object.entries(LEGACY_LISTS))('matches the legacy list for %s', (year, expected) => {
    expect(colombianHolidays(Number(year)).map((holiday) => holiday.date)).toEqual(expected);
  });

  it('adds Virgen de Chiquinquirá only from 2026', () => {
    const names = (year: number) => colombianHolidays(year).map((holiday) => holiday.name);

    expect(names(2025)).not.toContain('Virgen de Chiquinquirá');
    expect(names(2026)).toContain('Virgen de Chiquinquirá');
  });

  it('moves movable holidays to a Monday and never duplicates a date', () => {
    for (const year of [2028, 2029, 2030, 2031]) {
      const holidays = colombianHolidays(year);
      const dates = holidays.map((holiday) => holiday.date);
      expect(new Set(dates).size).toBe(dates.length);

      const reyes = holidays.find((holiday) => holiday.name === 'Reyes Magos');
      expect(new Date(`${reyes?.date}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2038, '2038-04-25'],
  ])('computes Easter %i', (year, expected) => {
    expect(easterSunday(year).toISOString().slice(0, 10)).toBe(expected);
  });
});
