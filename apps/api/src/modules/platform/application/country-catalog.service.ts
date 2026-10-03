import { Inject, Injectable } from '@nestjs/common';
import { holidayGeneratorFor } from '@procesabpm/db';
import {
  type AddCountryHolidayRequest,
  type CountrySummary,
  type CreateCountryRequest,
  type CountryHolidayResponse,
  InvalidStateError,
  NotFoundError,
  type RegeneratedHolidays,
} from '@procesabpm/shared';
import { type PlatformTransaction, PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { CountryCatalogRepository } from '../data/country-catalog.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** The global catalog the SLA calendars rely on: countries and their public holidays. */
@Injectable()
export class CountryCatalogService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(CountryCatalogRepository) private readonly catalog: CountryCatalogRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  listCountries(): Promise<CountrySummary[]> {
    return this.runner.run(async (tx) => (await this.catalog.listCountries(tx)).map((country) => ({ ...country, hasHolidayGenerator: holidayGeneratorFor(country.code) !== undefined })));
  }

  createCountry(actorUserId: string, request: CreateCountryRequest): Promise<CountrySummary> {
    return this.runner.run(async (tx) => {
      await this.catalog.createCountry(tx, request);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.countryCreated, data: { code: request.code, currencyCode: request.currencyCode, timeZone: request.timeZone } });
      return { ...request, tenants: 0, hasHolidayGenerator: holidayGeneratorFor(request.code) !== undefined };
    });
  }

  listHolidays(countryCode: string, year: number): Promise<CountryHolidayResponse[]> {
    return this.runner.run(async (tx) => {
      await this.assertCountry(tx, countryCode);
      return this.catalog.listHolidays(tx, countryCode, year);
    });
  }

  addHoliday(actorUserId: string, countryCode: string, request: AddCountryHolidayRequest): Promise<CountryHolidayResponse> {
    return this.runner.run(async (tx) => {
      await this.assertCountry(tx, countryCode);
      await this.catalog.addHoliday(tx, countryCode, request);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.holidayAdded, data: { countryCode, date: request.date, name: request.name } });
      return request;
    });
  }

  deleteHoliday(actorUserId: string, countryCode: string, date: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if (!(await this.catalog.deleteHoliday(tx, countryCode, date))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.holidayDeleted, data: { countryCode, date } });
    });
  }

  regenerateYear(actorUserId: string, countryCode: string, year: number): Promise<RegeneratedHolidays> {
    return this.runner.run(async (tx) => {
      await this.assertCountry(tx, countryCode);
      const generate = holidayGeneratorFor(countryCode);
      if (generate === undefined) throw new InvalidStateError(`No holiday calendar is shipped for ${countryCode}; add its holidays by hand`);
      const holidays = generate(year);
      await this.catalog.replaceYear(tx, countryCode, year, holidays);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.holidaysRegenerated, data: { countryCode, year, count: holidays.length } });
      return { year, holidays };
    });
  }

  private async assertCountry(tx: PlatformTransaction, code: string): Promise<void> {
    if (!(await this.catalog.countryExists(tx, code))) throw new NotFoundError();
  }
}
