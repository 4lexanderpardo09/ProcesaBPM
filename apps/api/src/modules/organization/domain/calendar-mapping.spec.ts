import { describe, expect, it } from 'vitest';
import { formatDate, formatTimeOfDay, toBusinessCalendar } from './calendar-mapping.js';

describe('calendar mapping', () => {
  it('formats the Prisma time and date values', () => {
    expect(formatTimeOfDay(new Date('1970-01-01T08:30:00Z'))).toBe('08:30');
    expect(formatDate(new Date('2026-12-25T00:00:00Z'))).toBe('2026-12-25');
  });

  it('builds the business calendar of the SLA engine', () => {
    expect(
      toBusinessCalendar({
        timeZone: 'America/Bogota',
        workingHours: [{ weekday: 1, startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T12:00:00Z') }],
        holidays: [{ date: new Date('2026-12-25T00:00:00Z') }],
      }),
    ).toEqual({ timeZone: 'America/Bogota', slots: [{ weekday: 1, startTime: '08:00', endTime: '12:00' }], holidays: ['2026-12-25'] });
  });
});
