import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientWith, connectTestDatabase, type Method } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const ANY_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

interface AdminRoute {
  readonly method: Method;
  readonly path: string;
  readonly action: string;
  readonly subject: string;
}

const crud = (path: string, subject: string): AdminRoute[] => [
  { method: 'get', path, action: 'read', subject },
  { method: 'get', path: `${path}/${ANY_ID}`, action: 'read', subject },
  { method: 'post', path, action: 'create', subject },
  { method: 'patch', path: `${path}/${ANY_ID}`, action: 'update', subject },
  { method: 'post', path: `${path}/${ANY_ID}/activate`, action: 'update', subject },
  { method: 'post', path: `${path}/${ANY_ID}/deactivate`, action: 'delete', subject },
];

/** Every route of the organization and catalog modules with the permission it must demand. */
const ROUTES: AdminRoute[] = [
  ...crud('/companies', 'Company'),
  { method: 'post', path: `/companies/${ANY_ID}/make-default`, action: 'update', subject: 'Company' },
  ...crud('/departments', 'Department'),
  ...crud('/positions', 'Position'),
  ...crud('/sites', 'Site'),
  { method: 'get', path: '/sites/tree', action: 'read', subject: 'Site' },
  { method: 'post', path: `/sites/${ANY_ID}/move`, action: 'update', subject: 'Site' },
  { method: 'get', path: '/site-levels', action: 'read', subject: 'Site' },
  { method: 'put', path: '/site-levels/1', action: 'update', subject: 'Site' },
  { method: 'delete', path: '/site-levels/1', action: 'delete', subject: 'Site' },
  { method: 'get', path: '/calendars', action: 'read', subject: 'Calendar' },
  { method: 'get', path: `/calendars/${ANY_ID}`, action: 'read', subject: 'Calendar' },
  { method: 'post', path: '/calendars', action: 'create', subject: 'Calendar' },
  { method: 'patch', path: `/calendars/${ANY_ID}`, action: 'update', subject: 'Calendar' },
  { method: 'delete', path: `/calendars/${ANY_ID}`, action: 'delete', subject: 'Calendar' },
  { method: 'put', path: `/calendars/${ANY_ID}/working-hours/1`, action: 'update', subject: 'Calendar' },
  { method: 'get', path: `/calendars/${ANY_ID}/holidays`, action: 'read', subject: 'Calendar' },
  { method: 'post', path: `/calendars/${ANY_ID}/holidays`, action: 'update', subject: 'Calendar' },
  { method: 'post', path: `/calendars/${ANY_ID}/holidays/import`, action: 'update', subject: 'Calendar' },
  { method: 'delete', path: `/calendars/${ANY_ID}/holidays/2026-01-01`, action: 'update', subject: 'Calendar' },
  { method: 'post', path: `/calendars/${ANY_ID}/preview`, action: 'read', subject: 'Calendar' },
  ...crud('/priorities', 'Priority'),
  ...crud('/categories', 'Category'),
  { method: 'get', path: `/categories/${ANY_ID}/visibility`, action: 'read', subject: 'Category' },
  { method: 'put', path: `/categories/${ANY_ID}/visibility`, action: 'update', subject: 'Category' },
  ...crud('/subcategories', 'Subcategory'),
];

describe('permissions of the organization and catalog APIs', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  let nobody: ApiClient;
  const byPermission = new Map<string, ApiClient>();

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    tenant = await seedTenant(db.platform);
    nobody = await clientWith(db, app, tenant, [], 'Nobody');
    for (const { action, subject } of ROUTES) {
      const key = `${action} ${subject}`;
      if (!byPermission.has(key)) byPermission.set(key, await clientWith(db, app, tenant, [{ action, subject }], key));
    }
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it.each(ROUTES.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route] as const))('%s: 403 without permission, passes the guard with exactly %s', async (_label, route) => {
    const denied = await nobody.call(route.method, route.path, {});
    expect({ status: denied.status, code: denied.body.error?.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    const allowed = await byPermission.get(`${route.action} ${route.subject}`)!.call(route.method, route.path, {});
    expect(allowed.status, JSON.stringify(allowed.body)).not.toBe(403);
    expect(allowed.status).not.toBe(401);
  });

  it('a role with only read access lists (200) but cannot create or change anything (403)', async () => {
    const reader = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Company' }], 'Reader');
    expect((await reader.get('/companies').expect(200)).body.items).toBeInstanceOf(Array);
    await reader.post('/companies', { name: unique('Nope'), countryCode: 'CO' }).expect(403);
    await reader.post(`/companies/${ANY_ID}/deactivate`).expect(403);
    await reader.get('/departments').expect(403);
  });

  it('permission on one subject does not open another', async () => {
    const departments = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Department' }, { action: 'create', subject: 'Department' }], 'Departments');
    await departments.post('/departments', { name: unique('Fine') }).expect(201);
    await departments.get('/positions').expect(403);
    await departments.get('/catalog/available').expect(403);
  });
});

describe('tenant isolation of the organization and catalog APIs', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let a: ApiClient;
  let b: ApiClient;
  let tenantA: SeededTenant;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin: a, tenant: tenantA } = await adminOf(db, app));
    ({ admin: b } = await adminOf(db, app));
    ids.company = (await a.post('/companies', { name: unique('A-company'), countryCode: 'CO' }).expect(201)).body.id;
    ids.department = (await a.post('/departments', { name: unique('A-dept') }).expect(201)).body.id;
    ids.position = (await a.post('/positions', { name: unique('A-pos') }).expect(201)).body.id;
    ids.site = (await a.post('/sites', { name: unique('A-site') }).expect(201)).body.id;
    ids.calendar = (await a.post('/calendars', { name: unique('A-cal'), countryCode: 'CO' }).expect(201)).body.id;
    ids.priority = (await a.post('/priorities', { name: unique('A-prio') }).expect(201)).body.id;
    ids.category = (await a.post('/categories', { name: unique('A-cat') }).expect(201)).body.id;
    ids.subcategory = (await a.post('/subcategories', { categoryId: ids.category, name: unique('A-sub') }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const RESOURCES = [
    ['companies', 'company'],
    ['departments', 'department'],
    ['positions', 'position'],
    ['sites', 'site'],
    ['calendars', 'calendar'],
    ['priorities', 'priority'],
    ['categories', 'category'],
    ['subcategories', 'subcategory'],
  ] as const;

  it.each(RESOURCES)('%s: another tenant cannot read, edit or toggle a record by id: always 404, never 403', async (path, key) => {
    const id = ids[key];
    expect((await b.get(`/${path}/${id}`).expect(404)).body.error.code).toBe('NOT_FOUND');
    await b.patch(`/${path}/${id}`, { name: 'hijacked' }).expect(404);
    if (path !== 'calendars') {
      await b.post(`/${path}/${id}/deactivate`).expect(404);
      await b.post(`/${path}/${id}/activate`).expect(404);
    }
    const mine = (await a.get(`/${path}/${id}`).expect(200)).body;
    expect(mine.name).not.toBe('hijacked');
    expect(mine.isActive ?? true).toBe(true);
  });

  it.each(RESOURCES)('%s: the listing of another tenant never contains the record', async (path, key) => {
    const listed = (await b.get(`/${path}?pageSize=100&includeInactive=true`).expect(200)).body.items as Array<{ id: string }>;
    expect(listed.map((item) => item.id)).not.toContain(ids[key]);
  });

  it('nested routes of a foreign record answer 404 as well', async () => {
    const id = ids.calendar;
    await b.put(`/calendars/${id}/working-hours/1`, { slots: [] }).expect(404);
    await b.get(`/calendars/${id}/holidays`).expect(404);
    await b.post(`/calendars/${id}/holidays`, { date: '2026-12-24', name: 'x' }).expect(404);
    await b.post(`/calendars/${id}/holidays/import`, { year: 2026 }).expect(404);
    await b.post(`/calendars/${id}/preview`, { start: '2026-10-09T13:00:00Z', amount: 1, unit: 'BUSINESS_HOURS' }).expect(404);
    await b.delete(`/calendars/${id}`).expect(404);
    await b.get(`/categories/${ids.category}/visibility`).expect(404);
    await b.put(`/categories/${ids.category}/visibility`, { companyIds: [], departmentIds: [] }).expect(404);
    await b.post(`/sites/${ids.site}/move`, { parentId: null }).expect(404);
    await b.post(`/companies/${ids.company}/make-default`).expect(404);
    expect((await a.get(`/calendars/${id}`).expect(200)).body.id).toBe(id);
  });

  it('a record of one tenant cannot be referenced from another (422): site parent, company calendar, subcategory category', async () => {
    await b.post('/sites', { name: unique('Child'), parentId: ids.site }).expect(422);
    await b.post('/companies', { name: unique('Co'), countryCode: 'CO', calendarId: ids.calendar }).expect(422);
    await b.post('/subcategories', { categoryId: ids.category, name: unique('Sub') }).expect(422);
    const ownSite = (await b.post('/sites', { name: unique('Own') }).expect(201)).body.id;
    await b.post(`/sites/${ownSite}/move`, { parentId: ids.site }).expect(422);
    expect((await a.get(`/sites/${ids.site}`).expect(200)).body.parentId).toBeNull();
  });

  it('the same names can exist in two tenants (uniqueness is per tenant)', async () => {
    const name = unique('Shared');
    await a.post('/departments', { name }).expect(201);
    await b.post('/departments', { name }).expect(201);
    expect(tenantA.tenantId).toBeDefined();
  });
});
