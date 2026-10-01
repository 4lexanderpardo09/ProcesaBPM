import { Inject, Injectable } from '@nestjs/common';
import {
  type AddHolidayRequest,
  type HolidayResponse,
  type ImportHolidaysResponse,
  InvalidStateError,
  NotFoundError,
} from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CalendarHolidayRepository } from '../data/calendar-holiday.repository.js';
import { CalendarRepository, type CalendarRow } from '../data/calendar.repository.js';
import { formatDate } from '../domain/calendar-mapping.js';

@Injectable()
export class CalendarHolidaysService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CalendarRepository) private readonly calendars: CalendarRepository,
    @Inject(CalendarHolidayRepository) private readonly holidays: CalendarHolidayRepository,
  ) {}

  list(calendarId: string, year?: number): Promise<HolidayResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireCalendar(tx, calendarId);
      const rows = await this.holidays.list(tx, this.tenantId, calendarId, year);
      return rows.map((row) => ({ date: formatDate(row.date), name: row.name }));
    });
  }

  /** A date already in the calendar is a duplicate (409, from the primary key). */
  add(calendarId: string, request: AddHolidayRequest): Promise<HolidayResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireCalendar(tx, calendarId);
      await this.holidays.add(tx, this.tenantId, calendarId, request);
      return request;
    });
  }

  remove(calendarId: string, date: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireCalendar(tx, calendarId);
      if (!(await this.holidays.remove(tx, this.tenantId, calendarId, date))) throw new NotFoundError();
    });
  }

  /** Copies the holidays of the calendar's country for the year; the ones already there are kept as they are. */
  importFromCountry(calendarId: string, year: number): Promise<ImportHolidaysResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const calendar = await this.requireCalendar(tx, calendarId);
      if (calendar.countryCode === null) throw new InvalidStateError('The calendar has no country to import holidays from');
      const imported = await this.holidays.importCountryHolidays(tx, this.tenantId, calendarId, calendar.countryCode, year);
      return { imported };
    });
  }

  private async requireCalendar(tx: TenantTransaction, id: string): Promise<CalendarRow> {
    const calendar = await this.calendars.findById(tx, this.tenantId, id);
    if (calendar === null) throw new NotFoundError();
    return calendar;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
