import { describe, expect, it } from 'vitest';
import { pageQuerySchema } from '../common.js';
import { createCompanyRequestSchema, previewDueDateRequestSchema, replaceWorkingDayRequestSchema, updateCompanyRequestSchema } from './schemas.js';

describe('organization contracts', () => {
  it('page query defaults and limits', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, includeInactive: false });
    expect(pageQuerySchema.parse({ page: '2', pageSize: '50', search: ' ab ', includeInactive: 'true' })).toEqual({ page: 2, pageSize: 50, search: 'ab', includeInactive: true });
    expect(pageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ includeInactive: 'yes' }).success).toBe(false);
  });

  it('a company needs a two-letter country in capitals and an update needs at least one field', () => {
    expect(createCompanyRequestSchema.safeParse({ name: 'A', countryCode: 'co' }).success).toBe(false);
    expect(createCompanyRequestSchema.safeParse({ name: 'A', countryCode: 'CO' }).success).toBe(true);
    expect(updateCompanyRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCompanyRequestSchema.safeParse({ calendarId: null }).success).toBe(true);
  });

  it('working slots must end after they start and use HH:mm', () => {
    expect(replaceWorkingDayRequestSchema.safeParse({ slots: [{ startTime: '08:00', endTime: '12:00' }] }).success).toBe(true);
    expect(replaceWorkingDayRequestSchema.safeParse({ slots: [{ startTime: '12:00', endTime: '12:00' }] }).success).toBe(false);
    expect(replaceWorkingDayRequestSchema.safeParse({ slots: [{ startTime: '24:00', endTime: '25:00' }] }).success).toBe(false);
  });

  it('a preview needs an ISO instant with offset and a positive amount', () => {
    const base = { start: '2026-10-09T13:00:00Z', amount: 1, unit: 'BUSINESS_HOURS' };
    expect(previewDueDateRequestSchema.safeParse(base).success).toBe(true);
    expect(previewDueDateRequestSchema.safeParse({ ...base, start: '2026-10-09' }).success).toBe(false);
    expect(previewDueDateRequestSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
});
