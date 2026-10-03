import type pg from 'pg';
import { holidayGeneratorFor } from '../holidays/generators.js';
import { COUNTRIES, CURRENCIES, PERMISSIONS, PLANS } from './catalog.js';

type Queryable = Pick<pg.ClientBase, 'query'>;

export interface SeedOptions {
  /** Years for which country holidays are loaded. */
  holidayYears: readonly number[];
}

/**
 * Loads the global catalog (currencies, countries, holidays, plans, permissions).
 * Idempotent: upserts by natural key, so it runs on every deploy (plans are only inserted: their limits belong to the console). Requires the
 * app_platform role (the API role cannot write global tables).
 */
export async function seedGlobalCatalog(db: Queryable, options: SeedOptions): Promise<void> {
  for (const currency of CURRENCIES) {
    await db.query(
      `INSERT INTO currencies (code, name, decimals) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, decimals = EXCLUDED.decimals`,
      [currency.code, currency.name, currency.decimals],
    );
  }

  for (const country of COUNTRIES) {
    await db.query(
      `INSERT INTO countries (code, name, currency_code, time_zone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, currency_code = EXCLUDED.currency_code, time_zone = EXCLUDED.time_zone`,
      [country.code, country.name, country.currencyCode, country.timeZone],
    );
    await seedCountryHolidays(db, country.code, options.holidayYears);
  }

  for (const plan of PLANS) {
    await db.query(
      // Insert only: the platform console edits the limits, and a deployment must not undo those edits.
      `INSERT INTO plans (code, name, storage_base_bytes, storage_per_user_bytes, max_users) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [plan.code, plan.name, plan.storageBaseBytes.toString(), plan.storagePerUserBytes.toString(), plan.maxUsers],
    );
  }

  for (const permission of PERMISSIONS) {
    await db.query(
      `INSERT INTO permissions (action, subject, description) VALUES ($1, $2, $3)
       ON CONFLICT (action, subject) DO UPDATE SET description = EXCLUDED.description`,
      [permission.action, permission.subject, permission.description],
    );
  }
}

async function seedCountryHolidays(db: Queryable, countryCode: string, years: readonly number[]): Promise<void> {
  const generate = holidayGeneratorFor(countryCode);
  if (!generate) return;

  for (const year of years) {
    for (const holiday of generate(year)) {
      await db.query(
        `INSERT INTO country_holidays (country_code, date, name) VALUES ($1, $2, $3)
         ON CONFLICT (country_code, date) DO UPDATE SET name = EXCLUDED.name`,
        [countryCode, holiday.date, holiday.name],
      );
    }
  }
}
