import { Injectable } from '@nestjs/common';
import type { CountrySummary, CreateCountryRequest, CountryHolidayResponse } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

@Injectable()
export class CountryCatalogRepository {
  async listCountries(tx: PlatformTransaction): Promise<Array<Omit<CountrySummary, 'hasHolidayGenerator'>>> {
    const rows = await tx.country.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true, currencyCode: true, timeZone: true, _count: { select: { tenants: true } } } });
    return rows.map(({ _count, ...country }) => ({ ...country, tenants: _count.tenants }));
  }

  async countryExists(tx: PlatformTransaction, code: string): Promise<boolean> {
    return (await tx.country.count({ where: { code } })) === 1;
  }

  async createCountry(tx: PlatformTransaction, country: CreateCountryRequest): Promise<void> {
    await tx.country.create({ data: country });
  }

  async listHolidays(tx: PlatformTransaction, countryCode: string, year: number): Promise<CountryHolidayResponse[]> {
    const rows = await tx.countryHoliday.findMany({
      where: { countryCode, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => ({ date: dayOf(row.date), name: row.name }));
  }

  async addHoliday(tx: PlatformTransaction, countryCode: string, holiday: CountryHolidayResponse): Promise<void> {
    await tx.countryHoliday.create({ data: { countryCode, date: new Date(`${holiday.date}T00:00:00Z`), name: holiday.name } });
  }

  async deleteHoliday(tx: PlatformTransaction, countryCode: string, date: string): Promise<boolean> {
    const { count } = await tx.countryHoliday.deleteMany({ where: { countryCode, date: new Date(`${date}T00:00:00Z`) } });
    return count > 0;
  }

  /** Replaces every holiday of the year: entries added by hand for that year go too. */
  async replaceYear(tx: PlatformTransaction, countryCode: string, year: number, holidays: readonly CountryHolidayResponse[]): Promise<void> {
    await tx.countryHoliday.deleteMany({ where: { countryCode, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } });
    await tx.countryHoliday.createMany({ data: holidays.map((holiday) => ({ countryCode, date: new Date(`${holiday.date}T00:00:00Z`), name: holiday.name })) });
  }
}
