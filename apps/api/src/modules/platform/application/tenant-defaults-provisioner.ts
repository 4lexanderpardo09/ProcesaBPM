import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_APPROVAL_GROUP_TYPE_NAME,
  DEFAULT_CALENDAR_NAME,
  DEFAULT_COMPANY_NAME,
  DEFAULT_ERROR_TYPES,
  DEFAULT_HOLIDAY_YEARS_AHEAD,
  DEFAULT_PRIORITIES,
  DEFAULT_WORKING_SLOTS,
} from '@procesabpm/db';
import { Clock } from '../../../infrastructure/clock.js';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';
import { type CountryReference } from '../data/tenant.repository.js';
import { TenantDefaultsRepository, type WorkingSlotRow } from '../data/tenant-defaults.repository.js';
import { calendarYearIn } from '../domain/tenant-signup-policy.js';

export interface TenantDefaults {
  readonly companyId: string;
}

/** What every new tenant starts with besides its roles: calendar, default company, catalogs. */
@Injectable()
export class TenantDefaultsProvisioner {
  constructor(
    @Inject(TenantDefaultsRepository) private readonly repository: TenantDefaultsRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async provision(tx: PlatformTransaction, tenantId: string, country: CountryReference): Promise<TenantDefaults> {
    const calendarId = await this.createCalendar(tx, tenantId, country);
    const companyId = await this.repository.createDefaultCompany(tx, tenantId, {
      name: DEFAULT_COMPANY_NAME,
      countryCode: country.code,
      currencyCode: country.currencyCode,
      timeZone: country.timeZone,
      calendarId,
    });
    await this.repository.createApprovalGroupType(tx, tenantId, DEFAULT_APPROVAL_GROUP_TYPE_NAME);
    await this.repository.createPriorities(tx, tenantId, DEFAULT_PRIORITIES);
    await this.repository.createErrorTypes(tx, tenantId, DEFAULT_ERROR_TYPES);
    return { companyId };
  }

  private async createCalendar(tx: PlatformTransaction, tenantId: string, country: CountryReference): Promise<string> {
    const calendarId = await this.repository.createCalendar(tx, tenantId, DEFAULT_CALENDAR_NAME, country.code);
    await this.repository.createWorkingHours(tx, tenantId, calendarId, workingSlotRows());
    const firstYear = calendarYearIn(country.timeZone, this.clock.now());
    await this.repository.copyCountryHolidays(
      tx,
      { tenantId, calendarId },
      { countryCode: country.code, from: `${firstYear}-01-01`, to: `${firstYear + DEFAULT_HOLIDAY_YEARS_AHEAD}-12-31` },
    );
    return calendarId;
  }
}

function workingSlotRows(): WorkingSlotRow[] {
  return DEFAULT_WORKING_SLOTS.flatMap(({ weekdays, startTime, endTime }) => weekdays.map((weekday) => ({ weekday, startTime, endTime })));
}
