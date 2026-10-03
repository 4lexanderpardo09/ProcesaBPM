import type { INestApplication } from '@nestjs/common';
import { colombianHolidays } from '@procesabpm/db';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('platform console: global catalog', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set(bearer(token));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('countries', () => {
    it('lists them with their tenants and whether a holiday calendar is shipped', async () => {
      await seedTenant(db.platform);
      const { body } = await asAdmin(http().get('/platform/catalog/countries')).expect(200);
      expect(body).toContainEqual(expect.objectContaining({ code: 'CO', currencyCode: 'COP', hasHolidayGenerator: true }));
      expect(body.find((country: { code: string }) => country.code === 'CO').tenants).toBeGreaterThan(0);
    });

    it('adds a country, audits it, and refuses duplicates, unknown currencies and bad time zones', async () => {
      const country = { code: 'EC', name: 'Ecuador', currencyCode: 'USD', timeZone: 'America/Guayaquil' };
      const created = await asAdmin(http().post('/platform/catalog/countries')).send(country).expect(201);
      expect(created.body).toEqual({ ...country, tenants: 0, hasHolidayGenerator: false });
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE action = 'country.created' AND data ->> 'code' = 'EC'`)).rowCount).toBe(1);

      expect((await asAdmin(http().post('/platform/catalog/countries')).send(country).expect(409)).body.error.code).toBe('DUPLICATE');
      expect((await asAdmin(http().post('/platform/catalog/countries')).send({ ...country, code: 'PE', currencyCode: 'PEN' }).expect(422)).body.error.code).toBe('INVALID_REFERENCE');
      await asAdmin(http().post('/platform/catalog/countries')).send({ ...country, code: 'PE', timeZone: 'Mars/Olympus' }).expect(422);
      await asAdmin(http().post('/platform/catalog/countries')).send({ ...country, code: 'ecu' }).expect(400);
    });
  });

  describe('holidays', () => {
    it('adds, lists by year and deletes a holiday, auditing the changes', async () => {
      const holiday = { date: '2031-03-10', name: 'Foundation day' };
      await asAdmin(http().post('/platform/catalog/countries/EC/holidays')).send(holiday).expect(201);
      expect((await asAdmin(http().post('/platform/catalog/countries/EC/holidays')).send(holiday).expect(409)).body.error.code).toBe('DUPLICATE');

      expect((await asAdmin(http().get('/platform/catalog/countries/EC/holidays?year=2031')).expect(200)).body).toEqual([holiday]);
      expect((await asAdmin(http().get('/platform/catalog/countries/EC/holidays?year=2032')).expect(200)).body).toEqual([]);

      await asAdmin(http().delete('/platform/catalog/countries/EC/holidays/2031-03-10')).expect(204);
      await asAdmin(http().delete('/platform/catalog/countries/EC/holidays/2031-03-10')).expect(404);
      const actions = await db.owner.query(`SELECT action FROM platform_audit_logs WHERE data ->> 'countryCode' = 'EC' ORDER BY created_at`);
      expect(actions.rows.map((row) => row.action)).toEqual(['holiday.added', 'holiday.deleted']);
    });

    it('answers 404 for an unknown country and 400 for malformed input', async () => {
      await asAdmin(http().get('/platform/catalog/countries/ZZ/holidays?year=2030')).expect(404);
      await asAdmin(http().post('/platform/catalog/countries/ZZ/holidays')).send({ date: '2030-01-01', name: 'x' }).expect(404);
      await asAdmin(http().get('/platform/catalog/countries/EC/holidays')).expect(400);
      await asAdmin(http().post('/platform/catalog/countries/EC/holidays')).send({ date: '2030-02-30', name: 'x' }).expect(400);
      await asAdmin(http().get('/platform/catalog/countries/ecu/holidays?year=2030')).expect(400);
    });

    it('regenerates a year from the shipped calendar, replacing what was there', async () => {
      await asAdmin(http().post('/platform/catalog/countries/CO/holidays')).send({ date: '2030-06-15', name: 'Manual entry' }).expect(201);
      const { body } = await asAdmin(http().post('/platform/catalog/countries/CO/holidays/regenerate')).send({ year: 2030 }).expect(200);
      const expected = colombianHolidays(2030);
      expect(body).toEqual({ year: 2030, holidays: expected });
      const stored = await asAdmin(http().get('/platform/catalog/countries/CO/holidays?year=2030')).expect(200);
      expect(stored.body).toEqual(expected);
      // Running it again changes nothing.
      await asAdmin(http().post('/platform/catalog/countries/CO/holidays/regenerate')).send({ year: 2030 }).expect(200);
      expect((await asAdmin(http().get('/platform/catalog/countries/CO/holidays?year=2030')).expect(200)).body).toEqual(expected);
      // Other years are not touched.
      expect((await asAdmin(http().get('/platform/catalog/countries/CO/holidays?year=2026')).expect(200)).body).toEqual(colombianHolidays(2026));
    });

    it('refuses to regenerate a country without a shipped calendar (422)', async () => {
      const response = await asAdmin(http().post('/platform/catalog/countries/EC/holidays/regenerate')).send({ year: 2030 }).expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });
  });

  it('a tenant user gets 403 and no token gets 401', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await http().get('/platform/catalog/countries').set(bearer(accessToken)).expect(403);
    await http().post('/platform/catalog/countries/CO/holidays/regenerate').set(bearer(accessToken)).send({ year: 2030 }).expect(403);
    await http().get('/platform/catalog/countries').expect(401);
  });
});
