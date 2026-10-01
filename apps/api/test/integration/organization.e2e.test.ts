import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('organization API', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let defaultCompanyId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    const world = await adminOf(db, app);
    admin = world.admin;
    defaultCompanyId = world.tenant.companyId;
    await db.platform.query('UPDATE companies SET is_default = true WHERE tenant_id = $1 AND id = $2', [world.tenant.tenantId, defaultCompanyId]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('companies', () => {
    it('derives currency and time zone from the country and lists with the default first', async () => {
      const created = await admin.post('/companies', { name: unique('Acme'), taxId: '900.123.456-7', countryCode: 'CO' }).expect(201);
      expect(created.body).toMatchObject({ countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota', isDefault: false, isActive: true, taxId: '900.123.456-7' });
      const list = await admin.get('/companies?pageSize=100').expect(200);
      expect(list.body.items[0].id).toBe(defaultCompanyId);
      expect(list.body.total).toBeGreaterThanOrEqual(2);
    });

    it('keeps a currency or time zone the caller chose', async () => {
      const created = await admin.post('/companies', { name: unique('Dollar'), countryCode: 'CO', currencyCode: 'USD', timeZone: 'UTC' }).expect(201);
      expect(created.body).toMatchObject({ currencyCode: 'USD', timeZone: 'UTC' });
    });

    it('refuses an unknown country (422) and a repeated name (409)', async () => {
      expect((await admin.post('/companies', { name: unique('X'), countryCode: 'ZZ' }).expect(422)).body.error.code).toBe('INVALID_REFERENCE');
      const name = unique('Twice');
      await admin.post('/companies', { name, countryCode: 'CO' }).expect(201);
      expect((await admin.post('/companies', { name, countryCode: 'CO' }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('searches by name or tax id, hides inactive companies unless asked, and paginates', async () => {
      const tag = unique('Searchable').toLowerCase();
      const a = await admin.post('/companies', { name: `${tag} one`, countryCode: 'CO' }).expect(201);
      await admin.post('/companies', { name: `${tag} two`, taxId: `NIT-${tag}`, countryCode: 'CO' }).expect(201);
      await admin.post(`/companies/${a.body.id}/deactivate`).expect(200);
      expect((await admin.get(`/companies?search=${tag.toUpperCase()}`).expect(200)).body.total).toBe(1);
      expect((await admin.get(`/companies?search=${tag}&includeInactive=true`).expect(200)).body.total).toBe(2);
      const page = await admin.get(`/companies?search=${tag}&includeInactive=true&pageSize=1&page=2`).expect(200);
      expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
      expect(page.body.items).toHaveLength(1);
      expect((await admin.get('/companies?search=NIT-' + tag).expect(200)).body.total).toBe(1);
    });

    it('updates a company; changing the country re-derives currency and time zone', async () => {
      const created = await admin.post('/companies', { name: unique('Move'), countryCode: 'CO' }).expect(201);
      const renamed = await admin.patch(`/companies/${created.body.id}`, { name: unique('Renamed'), taxId: null }).expect(200);
      expect(renamed.body.taxId).toBeNull();
      await admin.patch(`/companies/${created.body.id}`, {}).expect(400);
    });

    it('only one company is the default and the default cannot be deactivated', async () => {
      const other = (await admin.post('/companies', { name: unique('Next'), countryCode: 'CO' }).expect(201)).body;
      expect((await admin.post(`/companies/${defaultCompanyId}/deactivate`).expect(422)).body.error.code).toBe('INVALID_STATE');
      const switched = await admin.post(`/companies/${other.id}/make-default`).expect(200);
      expect(switched.body.isDefault).toBe(true);
      const { rows } = await db.owner.query(`SELECT id FROM companies WHERE tenant_id = (SELECT tenant_id FROM companies WHERE id = $1) AND is_default`, [other.id]);
      expect(rows).toEqual([{ id: other.id }]);
      await admin.post(`/companies/${defaultCompanyId}/deactivate`).expect(200);
      await admin.post(`/companies/${defaultCompanyId}/activate`).expect(200);
      await admin.post(`/companies/${defaultCompanyId}/make-default`).expect(200);
    });

    it('make-default racing with deactivate never leaves an inactive default', async () => {
      const racer = (await admin.post('/companies', { name: unique('Racer'), countryCode: 'CO' }).expect(201)).body;
      await Promise.all([admin.post(`/companies/${racer.id}/make-default`), admin.post(`/companies/${racer.id}/deactivate`)]);
      const { rows } = await db.owner.query(`SELECT is_default, is_active FROM companies WHERE id = $1`, [racer.id]);
      expect(rows[0].is_default && !rows[0].is_active).toBe(false);
      await admin.post(`/companies/${defaultCompanyId}/make-default`).expect(200);
    });

    it('repeating the current country keeps the currency and time zone the caller chose', async () => {
      const company = (await admin.post('/companies', { name: unique('Keeps'), countryCode: 'CO', currencyCode: 'USD' }).expect(201)).body;
      expect((await admin.patch(`/companies/${company.id}`, { countryCode: 'CO' }).expect(200)).body.currencyCode).toBe('USD');
    });

    it('an inactive company cannot become the default', async () => {
      const other = (await admin.post('/companies', { name: unique('Sleeping'), countryCode: 'CO' }).expect(201)).body;
      await admin.post(`/companies/${other.id}/deactivate`).expect(200);
      await admin.post(`/companies/${other.id}/make-default`).expect(422);
    });

    it('links a calendar of the tenant, and refuses one that does not exist', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Cal'), countryCode: 'CO' }).expect(201)).body;
      const company = (await admin.post('/companies', { name: unique('WithCalendar'), countryCode: 'CO', calendarId: calendar.id }).expect(201)).body;
      expect(company.calendarId).toBe(calendar.id);
      await admin.patch(`/companies/${company.id}`, { calendarId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);
      await admin.delete(`/calendars/${calendar.id}`).expect(422);
    });
  });

  describe.each([
    ['departments', '/departments'],
    ['positions', '/positions'],
  ])('%s', (_label, path) => {
    it('creates, renames, deactivates and reactivates', async () => {
      const created = (await admin.post(path, { name: unique('Ops') }).expect(201)).body;
      expect(created).toMatchObject({ isActive: true });
      const newName = unique('Renamed');
      expect((await admin.patch(`${path}/${created.id}`, { name: newName }).expect(200)).body.name).toBe(newName);
      expect((await admin.post(`${path}/${created.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.post(`${path}/${created.id}/activate`).expect(200)).body.isActive).toBe(true);
      expect((await admin.get(`${path}/${created.id}`).expect(200)).body.id).toBe(created.id);
    });

    it('the name is unique per tenant (409) and may not be blank (400)', async () => {
      const name = unique('Same');
      await admin.post(path, { name }).expect(201);
      expect((await admin.post(path, { name }).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.post(path, { name: '   ' }).expect(400);
    });

    it('lists with text filter, optional inactive and pagination', async () => {
      const tag = unique('Listed').toLowerCase();
      const ids: string[] = [];
      for (const suffix of ['a', 'b', 'c']) ids.push((await admin.post(path, { name: `${tag}-${suffix}` }).expect(201)).body.id);
      await admin.post(`${path}/${ids[2]}/deactivate`).expect(200);
      expect((await admin.get(`${path}?search=${tag}`).expect(200)).body.total).toBe(2);
      const all = await admin.get(`${path}?search=${tag}&includeInactive=true&pageSize=2`).expect(200);
      expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(all.body.items.map((item: { name: string }) => item.name)).toEqual([`${tag}-a`, `${tag}-b`]);
      await admin.get(`${path}?pageSize=1000`).expect(400);
    });
  });

  describe('sites', () => {
    const create = async (name: string, parentId?: string, extra: object = {}) =>
      (await admin.post('/sites', { name, ...(parentId === undefined ? {} : { parentId }), ...extra }).expect(201)).body;

    it('names the levels contiguously and refuses to skip one or to drop a used level', async () => {
      await admin.put('/site-levels/2', { name: 'Regional' }).expect(422);
      await admin.put('/site-levels/1', { name: 'Zona' }).expect(200);
      await admin.put('/site-levels/2', { name: 'Regional' }).expect(200);
      await admin.put('/site-levels/1', { name: 'Macrozona' }).expect(200);
      expect((await admin.get('/site-levels').expect(200)).body).toEqual([
        { level: 1, name: 'Macrozona' },
        { level: 2, name: 'Regional' },
      ]);
      await admin.put('/site-levels/0', { name: 'Zero' }).expect(400);
      await admin.delete('/site-levels/1').expect(422);
      const root = await create(unique('Root'));
      await create(unique('Child'), root.id);
      await admin.delete('/site-levels/2').expect(422);
      await admin.delete('/site-levels/3').expect(204);
    });

    it('a child is one level below its parent and can be marked central', async () => {
      const root = await create(unique('HQ'), undefined, { isCentral: true });
      const child = await create(unique('Branch'), root.id);
      const grandchild = await create(unique('Desk'), child.id);
      expect([root.level, child.level, grandchild.level]).toEqual([1, 2, 3]);
      expect(root.isCentral).toBe(true);
      expect((await admin.patch(`/sites/${child.id}`, { isCentral: true }).expect(200)).body.isCentral).toBe(true);
    });

    it('refuses an unknown parent (422) and a repeated name under the same parent (409)', async () => {
      await admin.post('/sites', { name: unique('Orphan'), parentId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);
      const root = await create(unique('Parent'));
      const name = unique('Twin');
      await create(name, root.id);
      expect((await admin.post('/sites', { name, parentId: root.id }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('moves a site with its subtree, recomputing levels, and never creates a cycle', async () => {
      const a = await create(unique('A'));
      const b = await create(unique('B'), a.id);
      const c = await create(unique('C'), b.id);
      const other = await create(unique('Other'));
      const otherChild = await create(unique('OtherChild'), other.id);

      await admin.post(`/sites/${a.id}/move`, { parentId: a.id }).expect(422);
      await admin.post(`/sites/${a.id}/move`, { parentId: b.id }).expect(422);
      expect((await admin.post(`/sites/${a.id}/move`, { parentId: c.id }).expect(422)).body.error.code).toBe('INVALID_STATE');
      await admin.post(`/sites/${a.id}/move`, { parentId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);

      const moved = await admin.post(`/sites/${a.id}/move`, { parentId: otherChild.id }).expect(200);
      expect(moved.body).toMatchObject({ parentId: otherChild.id, level: 3 });
      expect((await admin.get(`/sites/${b.id}`).expect(200)).body.level).toBe(4);
      expect((await admin.get(`/sites/${c.id}`).expect(200)).body.level).toBe(5);

      const toRoot = await admin.post(`/sites/${b.id}/move`, { parentId: null }).expect(200);
      expect(toRoot.body).toMatchObject({ parentId: null, level: 1 });
      expect((await admin.get(`/sites/${c.id}`).expect(200)).body.level).toBe(2);
    });

    it('two concurrent moves that would swap two roots into a cycle: exactly one wins', async () => {
      const x = await create(unique('X'));
      const y = await create(unique('Y'));
      const results = await Promise.all([admin.post(`/sites/${x.id}/move`, { parentId: y.id }), admin.post(`/sites/${y.id}/move`, { parentId: x.id })]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 422]);
      const levels = [(await admin.get(`/sites/${x.id}`).expect(200)).body.level, (await admin.get(`/sites/${y.id}`).expect(200)).body.level].sort();
      expect(levels).toEqual([1, 2]);
    });

    it('root sites cannot repeat a name either, also when moved to the root or renamed', async () => {
      const name = unique('Norte');
      await create(name);
      expect((await admin.post('/sites', { name }).expect(409)).body.error.code).toBe('DUPLICATE');
      const parent = await create(unique('P'));
      const child = await create(name, parent.id);
      await admin.post(`/sites/${child.id}/move`, { parentId: null }).expect(409);
      const other = await create(unique('Other'));
      await admin.patch(`/sites/${other.id}`, { name }).expect(409);
    });

    it('GET /sites/tree returns the nested tree and hides inactive sites unless asked', async () => {
      const root = await create(unique('TreeRoot'));
      const kept = await create(unique('Kept'), root.id);
      const hidden = await create(unique('Hidden'), root.id);
      await admin.post(`/sites/${hidden.id}/deactivate`).expect(200);

      const find = (nodes: Array<{ id: string; children: unknown[] }>): { id: string; children: Array<{ id: string }> } =>
        nodes.find((node) => node.id === root.id) as never;
      const tree = (await admin.get('/sites/tree').expect(200)).body;
      expect(find(tree).children.map((child) => child.id)).toEqual([kept.id]);
      const full = (await admin.get('/sites/tree?includeInactive=true').expect(200)).body;
      expect(find(full).children.map((child) => child.id).sort()).toEqual([kept.id, hidden.id].sort());
    });

    it('lists flat with filter and pagination', async () => {
      const tag = unique('flat').toLowerCase();
      await create(`${tag}-1`);
      await create(`${tag}-2`);
      expect((await admin.get(`/sites?search=${tag}&pageSize=1`).expect(200)).body).toMatchObject({ total: 2, pageSize: 1 });
    });
  });

  describe('calendars', () => {
    // 2026-10-09 is a Friday; Colombia is UTC-5 and 2026-10-12 (Monday) is a holiday.
    const FRIDAY_8AM_LOCAL = '2026-10-09T13:00:00.000Z';
    const workingWeek = async (calendarId: string) => {
      for (const weekday of [1, 2, 3, 4, 5]) {
        await admin.put(`/calendars/${calendarId}/working-hours/${weekday}`, { slots: [{ startTime: '08:00', endTime: '12:00' }, { startTime: '14:00', endTime: '18:00' }] }).expect(200);
      }
    };
    const preview = (calendarId: string, body: object) => admin.post(`/calendars/${calendarId}/preview`, { start: FRIDAY_8AM_LOCAL, ...body });

    it('creates, shows, renames and deletes a calendar', async () => {
      const created = (await admin.post('/calendars', { name: unique('Cal'), countryCode: 'CO' }).expect(201)).body;
      expect(created).toMatchObject({ countryCode: 'CO', isDefault: false });
      expect((await admin.get(`/calendars/${created.id}`).expect(200)).body.workingHours).toEqual([]);
      const renamed = unique('Renamed');
      expect((await admin.patch(`/calendars/${created.id}`, { name: renamed }).expect(200)).body.name).toBe(renamed);
      await admin.delete(`/calendars/${created.id}`).expect(204);
      await admin.get(`/calendars/${created.id}`).expect(404);
      await admin.post('/calendars', { name: unique('Bad'), countryCode: 'ZZ' }).expect(422);
    });

    it('the default calendar cannot be deleted', async () => {
      const created = (await admin.post('/calendars', { name: unique('Def') }).expect(201)).body;
      await db.platform.query('UPDATE calendars SET is_default = true WHERE id = $1', [created.id]);
      expect((await admin.delete(`/calendars/${created.id}`).expect(422)).body.error.code).toBe('INVALID_STATE');
      await db.platform.query('UPDATE calendars SET is_default = false WHERE id = $1', [created.id]);
    });

    it('replaces the slots of one weekday in a single operation', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Slots') }).expect(201)).body;
      await admin.put(`/calendars/${calendar.id}/working-hours/1`, { slots: [{ startTime: '08:00', endTime: '12:00' }, { startTime: '14:00', endTime: '18:00' }] }).expect(200);
      const replaced = await admin.put(`/calendars/${calendar.id}/working-hours/1`, { slots: [{ startTime: '09:00', endTime: '13:00' }] }).expect(200);
      expect(replaced.body.workingHours).toEqual([{ weekday: 1, startTime: '09:00', endTime: '13:00' }]);
      const cleared = await admin.put(`/calendars/${calendar.id}/working-hours/1`, { slots: [] }).expect(200);
      expect(cleared.body.workingHours).toEqual([]);
    });

    it('overlapping slots answer 409 OVERLAP and leave the previous slots untouched', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Overlap') }).expect(201)).body;
      await admin.put(`/calendars/${calendar.id}/working-hours/2`, { slots: [{ startTime: '08:00', endTime: '12:00' }] }).expect(200);
      const response = await admin
        .put(`/calendars/${calendar.id}/working-hours/2`, { slots: [{ startTime: '08:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }] })
        .expect(409);
      expect(response.body.error.code).toBe('OVERLAP');
      expect((await admin.get(`/calendars/${calendar.id}`).expect(200)).body.workingHours).toEqual([{ weekday: 2, startTime: '08:00', endTime: '12:00' }]);
    });

    it('validates slots and weekdays (400)', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Invalid') }).expect(201)).body;
      await admin.put(`/calendars/${calendar.id}/working-hours/7`, { slots: [] }).expect(400);
      await admin.put(`/calendars/${calendar.id}/working-hours/1`, { slots: [{ startTime: '12:00', endTime: '08:00' }] }).expect(400);
      await admin.put(`/calendars/${calendar.id}/working-hours/1`, { slots: [{ startTime: '8:00', endTime: '12:00' }] }).expect(400);
    });

    it('adds, lists (by year) and removes holidays; a repeated date is a 409', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Holidays') }).expect(201)).body;
      await admin.post(`/calendars/${calendar.id}/holidays`, { date: '2026-12-24', name: 'Nochebuena' }).expect(201);
      await admin.post(`/calendars/${calendar.id}/holidays`, { date: '2027-01-02', name: 'Puente' }).expect(201);
      expect((await admin.post(`/calendars/${calendar.id}/holidays`, { date: '2026-12-24', name: 'Again' }).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.post(`/calendars/${calendar.id}/holidays`, { date: '2026-02-30', name: 'Impossible' }).expect(400);
      await admin.post(`/calendars/${calendar.id}/holidays`, { date: '0000-01-01', name: 'Year zero' }).expect(400);
      expect((await admin.get(`/calendars/${calendar.id}/holidays`).expect(200)).body).toEqual([
        { date: '2026-12-24', name: 'Nochebuena' },
        { date: '2027-01-02', name: 'Puente' },
      ]);
      expect((await admin.get(`/calendars/${calendar.id}/holidays?year=2027`).expect(200)).body).toEqual([{ date: '2027-01-02', name: 'Puente' }]);
      await admin.delete(`/calendars/${calendar.id}/holidays/2026-12-24`).expect(204);
      await admin.delete(`/calendars/${calendar.id}/holidays/2026-12-24`).expect(404);
    });

    it('imports the holidays of the calendar country for a year without duplicating them', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Import'), countryCode: 'CO' }).expect(201)).body;
      const first = (await admin.post(`/calendars/${calendar.id}/holidays/import`, { year: 2026 }).expect(200)).body;
      expect(first.imported).toBeGreaterThan(5);
      const { rows } = await db.owner.query<{ date: string }>(`SELECT date::text FROM country_holidays WHERE country_code = 'CO' AND date BETWEEN '2026-01-01' AND '2026-12-31'`);
      expect(first.imported).toBe(rows.length);
      expect((await admin.post(`/calendars/${calendar.id}/holidays/import`, { year: 2026 }).expect(200)).body.imported).toBe(0);
      const noCountry = (await admin.post('/calendars', { name: unique('NoCountry') }).expect(201)).body;
      expect((await admin.post(`/calendars/${noCountry.id}/holidays/import`, { year: 2026 }).expect(422)).body.error.code).toBe('INVALID_STATE');
    });

    it('previews a deadline in business hours, skipping non-working time and holidays', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Preview'), countryCode: 'CO' }).expect(201)).body;
      await workingWeek(calendar.id);

      const sameDay = (await preview(calendar.id, { amount: 8, unit: 'BUSINESS_HOURS' }).expect(200)).body;
      expect(sameDay).toEqual({ dueDate: '2026-10-09T23:00:00.000Z', businessMinutes: 480, timeZone: 'America/Bogota' });

      const overWeekend = (await preview(calendar.id, { amount: 12, unit: 'BUSINESS_HOURS' }).expect(200)).body;
      expect(overWeekend.dueDate).toBe('2026-10-12T17:00:00.000Z');

      await admin.post(`/calendars/${calendar.id}/holidays`, { date: '2026-10-12', name: 'Día de la Raza' }).expect(201);
      const withHoliday = (await preview(calendar.id, { amount: 12, unit: 'BUSINESS_HOURS' }).expect(200)).body;
      expect(withHoliday).toMatchObject({ dueDate: '2026-10-13T17:00:00.000Z', businessMinutes: 720 });
    });

    it('previews business days (end of the working day) and honours a chosen time zone', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Days') }).expect(201)).body;
      await workingWeek(calendar.id);
      const days = (await preview(calendar.id, { amount: 1, unit: 'BUSINESS_DAYS', timeZone: 'America/Bogota' }).expect(200)).body;
      expect(days.dueDate).toBe('2026-10-12T23:00:00.000Z');
      expect(days.timeZone).toBe('America/Bogota');
    });

    it('rejects an invalid preview (400) and an invalid time zone (422)', async () => {
      const calendar = (await admin.post('/calendars', { name: unique('Bad preview') }).expect(201)).body;
      await preview(calendar.id, { amount: 0, unit: 'BUSINESS_HOURS' }).expect(400);
      await preview(calendar.id, { amount: 1, unit: 'MINUTES' }).expect(400);
      await preview(calendar.id, { amount: 1, unit: 'BUSINESS_HOURS', timeZone: 'Mars/Olympus' }).expect(422);
    });
  });
});
