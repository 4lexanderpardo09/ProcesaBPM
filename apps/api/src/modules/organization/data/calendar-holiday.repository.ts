import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface HolidayRow {
  readonly date: Date;
  readonly name: string;
}

const dateColumn = (value: string): Date => new Date(`${value}T00:00:00Z`);

@Injectable()
export class CalendarHolidayRepository {
  list(tx: TenantTransaction, tenantId: string, calendarId: string, year?: number): Promise<HolidayRow[]> {
    return tx.calendarHoliday.findMany({
      where: {
        tenantId,
        calendarId,
        ...(year === undefined ? {} : { date: { gte: dateColumn(`${year}-01-01`), lte: dateColumn(`${year}-12-31`) } }),
      },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    });
  }

  async add(tx: TenantTransaction, tenantId: string, calendarId: string, holiday: { date: string; name: string }): Promise<void> {
    await tx.calendarHoliday.create({ data: { tenantId, calendarId, date: dateColumn(holiday.date), name: holiday.name } });
  }

  async remove(tx: TenantTransaction, tenantId: string, calendarId: string, date: string): Promise<boolean> {
    const { count } = await tx.calendarHoliday.deleteMany({ where: { tenantId, calendarId, date: dateColumn(date) } });
    return count > 0;
  }

  /** Copies the holidays the country has for `year` that the calendar does not have yet; returns how many. */
  importCountryHolidays(tx: TenantTransaction, tenantId: string, calendarId: string, countryCode: string, year: number): Promise<number> {
    return tx.$executeRaw`
      INSERT INTO calendar_holidays (tenant_id, calendar_id, date, name)
      SELECT ${tenantId}::uuid, ${calendarId}::uuid, h.date, h.name
      FROM country_holidays h
      WHERE h.country_code = ${countryCode} AND h.date BETWEEN ${`${year}-01-01`}::date AND ${`${year}-12-31`}::date
      ON CONFLICT (tenant_id, calendar_id, date) DO NOTHING`;
  }
}
