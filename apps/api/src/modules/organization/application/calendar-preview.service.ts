import { Inject, Injectable } from '@nestjs/common';
import {
  businessMinutesBetween,
  calculateDueDate,
  NotFoundError,
  type PreviewDueDateRequest,
  type PreviewDueDateResponse,
} from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CalendarHolidayRepository } from '../data/calendar-holiday.repository.js';
import { CalendarRepository, type CalendarRow } from '../data/calendar.repository.js';
import { toBusinessCalendar } from '../domain/calendar-mapping.js';

/** Computes an SLA deadline on a stored calendar with the engine of `packages/shared` (no writes). */
@Injectable()
export class CalendarPreviewService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CalendarRepository) private readonly calendars: CalendarRepository,
    @Inject(CalendarHolidayRepository) private readonly holidays: CalendarHolidayRepository,
  ) {}

  preview(calendarId: string, request: PreviewDueDateRequest): Promise<PreviewDueDateResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const calendar = await this.calendars.findById(tx, tenantId, calendarId);
      if (calendar === null) throw new NotFoundError();
      const timeZone = request.timeZone ?? (await this.defaultTimeZone(tx, tenantId, calendar));
      const business = toBusinessCalendar({
        timeZone,
        workingHours: await this.calendars.findWorkingHours(tx, tenantId, calendarId),
        holidays: await this.holidays.list(tx, tenantId, calendarId),
      });
      const start = new Date(request.start);
      const dueDate = calculateDueDate({ start, amount: request.amount, unit: request.unit, calendar: business });
      return {
        dueDate: dueDate.toISOString(),
        businessMinutes: businessMinutesBetween({ start, end: dueDate, calendar: business }),
        timeZone,
      };
    });
  }

  /** The country of the calendar decides; without one, the tenant's own time zone. */
  private async defaultTimeZone(tx: TenantTransaction, tenantId: string, calendar: CalendarRow): Promise<string> {
    const fromCountry = calendar.countryCode === null ? undefined : await this.calendars.findCountryTimeZone(tx, calendar.countryCode);
    return fromCountry ?? (await this.calendars.findTenantTimeZone(tx, tenantId)) ?? 'UTC';
  }
}
