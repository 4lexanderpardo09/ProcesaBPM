import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedTenant, type SeededTenant, withPlatformTransaction } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientOf, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

describe('catalog API', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('priorities', () => {
    it('creates with order and color, lists ordered, updates and toggles', async () => {
      const low = (await admin.post('/priorities', { name: unique('Low'), sortOrder: 9001, color: '#2E7D32' }).expect(201)).body;
      const high = (await admin.post('/priorities', { name: unique('High'), sortOrder: 9000 }).expect(201)).body;
      expect(low).toMatchObject({ sortOrder: 9001, color: '#2E7D32', isActive: true });
      const listed = (await admin.get('/priorities?pageSize=100').expect(200)).body.items.map((item: { id: string }) => item.id);
      expect(listed.indexOf(high.id)).toBeLessThan(listed.indexOf(low.id));
      expect((await admin.patch(`/priorities/${high.id}`, { color: '#C62828', sortOrder: 9002 }).expect(200)).body).toMatchObject({ color: '#C62828', sortOrder: 9002 });
      expect((await admin.patch(`/priorities/${high.id}`, { color: null }).expect(200)).body.color).toBeNull();
      expect((await admin.post(`/priorities/${high.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.post(`/priorities/${high.id}/activate`).expect(200)).body.isActive).toBe(true);
    });

    it('refuses a bad color (400) and a repeated name (409)', async () => {
      await admin.post('/priorities', { name: unique('Bad'), color: 'red' }).expect(400);
      const name = unique('Dup');
      await admin.post('/priorities', { name }).expect(201);
      expect((await admin.post('/priorities', { name }).expect(409)).body.error.code).toBe('DUPLICATE');
    });
  });

  describe('categories and visibility', () => {
    it('creates, renames, toggles, lists with filter and hides inactive ones', async () => {
      const tag = unique('cat').toLowerCase();
      const a = (await admin.post('/categories', { name: `${tag}-a` }).expect(201)).body;
      const b = (await admin.post('/categories', { name: `${tag}-b` }).expect(201)).body;
      expect((await admin.patch(`/categories/${a.id}`, { name: `${tag}-renamed` }).expect(200)).body.name).toBe(`${tag}-renamed`);
      await admin.post(`/categories/${b.id}/deactivate`).expect(200);
      expect((await admin.get(`/categories?search=${tag}`).expect(200)).body.total).toBe(1);
      expect((await admin.get(`/categories?search=${tag}&includeInactive=true`).expect(200)).body.total).toBe(2);
      expect((await admin.post('/categories', { name: `${tag}-renamed` }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('replaces the visibility lists and returns them', async () => {
      const company = (await admin.post('/companies', { name: unique('VisCo'), countryCode: 'CO' }).expect(201)).body;
      const department = (await admin.post('/departments', { name: unique('VisDept') }).expect(201)).body;
      const category = (await admin.post('/categories', { name: unique('Visible') }).expect(201)).body;
      expect((await admin.get(`/categories/${category.id}/visibility`).expect(200)).body).toEqual({ companyIds: [], departmentIds: [] });
      const set = await admin.put(`/categories/${category.id}/visibility`, { companyIds: [company.id], departmentIds: [department.id] }).expect(200);
      expect(set.body).toEqual({ companyIds: [company.id], departmentIds: [department.id] });
      const cleared = await admin.put(`/categories/${category.id}/visibility`, { companyIds: [], departmentIds: [department.id] }).expect(200);
      expect(cleared.body).toEqual({ companyIds: [], departmentIds: [department.id] });
      await admin.put(`/categories/${category.id}/visibility`, { companyIds: [company.id, company.id], departmentIds: [] }).expect(400);
    });

    it('refuses a company or department that does not belong to the tenant, and keeps the old lists', async () => {
      const other = await seedTenant(db.platform);
      const otherDepartment = await insertReturningId(db.platform, `INSERT INTO departments (tenant_id, name) VALUES ($1, 'Foreign') RETURNING id`, [other.tenantId]);
      const category = (await admin.post('/categories', { name: unique('Guarded') }).expect(201)).body;
      const company = (await admin.post('/companies', { name: unique('Own'), countryCode: 'CO' }).expect(201)).body;
      await admin.put(`/categories/${category.id}/visibility`, { companyIds: [company.id], departmentIds: [] }).expect(200);
      await admin.put(`/categories/${category.id}/visibility`, { companyIds: [other.companyId], departmentIds: [] }).expect(422);
      await admin.put(`/categories/${category.id}/visibility`, { companyIds: [], departmentIds: [otherDepartment] }).expect(422);
      expect((await admin.get(`/categories/${category.id}/visibility`).expect(200)).body.companyIds).toEqual([company.id]);
    });
  });

  describe('subcategories', () => {
    it('creates with a default priority, lists by category and updates', async () => {
      const priority = (await admin.post('/priorities', { name: unique('Default') }).expect(201)).body;
      const category = (await admin.post('/categories', { name: unique('Parent') }).expect(201)).body;
      const sibling = (await admin.post('/categories', { name: unique('Sibling') }).expect(201)).body;
      const sub = (await admin.post('/subcategories', { categoryId: category.id, name: unique('Sub'), description: 'Does things', defaultPriorityId: priority.id }).expect(201)).body;
      await admin.post('/subcategories', { categoryId: sibling.id, name: unique('Other') }).expect(201);
      expect(sub).toMatchObject({ categoryId: category.id, defaultPriorityId: priority.id, description: 'Does things' });
      const byCategory = (await admin.get(`/subcategories?categoryId=${category.id}`).expect(200)).body;
      expect(byCategory.items.map((item: { id: string }) => item.id)).toEqual([sub.id]);
      const updated = (await admin.patch(`/subcategories/${sub.id}`, { description: null, defaultPriorityId: null, categoryId: sibling.id }).expect(200)).body;
      expect(updated).toMatchObject({ description: null, defaultPriorityId: null, categoryId: category.id });
    });

    it('the name is unique within the category only', async () => {
      const first = (await admin.post('/categories', { name: unique('First') }).expect(201)).body;
      const second = (await admin.post('/categories', { name: unique('Second') }).expect(201)).body;
      const name = unique('Shared');
      await admin.post('/subcategories', { categoryId: first.id, name }).expect(201);
      await admin.post('/subcategories', { categoryId: second.id, name }).expect(201);
      expect((await admin.post('/subcategories', { categoryId: first.id, name }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('refuses a category or priority of another tenant (422)', async () => {
      const other = await seedTenant(db.platform);
      const foreignCategory = await insertReturningId(db.platform, `INSERT INTO categories (tenant_id, name) VALUES ($1, 'Foreign') RETURNING id`, [other.tenantId]);
      const foreignPriority = await insertReturningId(db.platform, `INSERT INTO priorities (tenant_id, name) VALUES ($1, 'Foreign') RETURNING id`, [other.tenantId]);
      const category = (await admin.post('/categories', { name: unique('Own') }).expect(201)).body;
      await admin.post('/subcategories', { categoryId: foreignCategory, name: unique('X') }).expect(422);
      await admin.post('/subcategories', { categoryId: category.id, name: unique('Y'), defaultPriorityId: foreignPriority }).expect(422);
    });

    it('deactivates and reactivates', async () => {
      const category = (await admin.post('/categories', { name: unique('Toggle') }).expect(201)).body;
      const sub = (await admin.post('/subcategories', { categoryId: category.id, name: unique('T') }).expect(201)).body;
      expect((await admin.post(`/subcategories/${sub.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.get(`/subcategories?categoryId=${category.id}`).expect(200)).body.total).toBe(0);
      expect((await admin.get(`/subcategories?categoryId=${category.id}&includeInactive=true`).expect(200)).body.total).toBe(1);
      expect((await admin.post(`/subcategories/${sub.id}/activate`).expect(200)).body.isActive).toBe(true);
    });
  });

  describe('GET /catalog/available (visibility by company and department)', () => {
    let world: SeededTenant;
    let owner: ApiClient;
    let companyA: string;
    let companyB: string;
    let deptX: string;
    let deptY: string;
    const names: Record<string, string> = {};

    const category = async (key: string, visibility: { companyIds?: string[]; departmentIds?: string[] } = {}, options: { active?: boolean; subcategories?: Array<{ name: string; active?: boolean }> } = {}) => {
      const created = (await owner.post('/categories', { name: unique(key) }).expect(201)).body;
      names[created.id] = key;
      await owner.put(`/categories/${created.id}/visibility`, { companyIds: visibility.companyIds ?? [], departmentIds: visibility.departmentIds ?? [] }).expect(200);
      for (const sub of options.subcategories ?? [{ name: 'only' }]) {
        const subcategory = (await owner.post('/subcategories', { categoryId: created.id, name: sub.name }).expect(201)).body;
        if (sub.active === false) await owner.post(`/subcategories/${subcategory.id}/deactivate`).expect(200);
      }
      if (options.active === false) await owner.post(`/categories/${created.id}/deactivate`).expect(200);
      return created.id as string;
    };
    const keysSeenBy = async (client: ApiClient, query = '') => {
      const { categories } = (await client.get(`/catalog/available${query}`).expect(200)).body as { categories: Array<{ id: string }> };
      return categories.map((entry) => names[entry.id]).filter((key) => key !== undefined).sort();
    };
    const member = async (companyIds: string[], departmentId?: string) => {
      const client = await clientOf(db, app, world);
      const { rows } = await db.platform.query<{ user_id: string }>(`SELECT user_id FROM memberships WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [world.tenantId]);
      const userId = rows[0]!.user_id;
      await withPlatformTransaction(db.platform, async (tx) => {
        for (const companyId of companyIds) {
          await tx.query('INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [world.tenantId, userId, companyId]);
        }
        await tx.query('DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2 AND company_id <> ALL($3::uuid[])', [world.tenantId, userId, companyIds]);
      });
      if (departmentId !== undefined) await db.platform.query('UPDATE memberships SET department_id = $3 WHERE tenant_id = $1 AND user_id = $2', [world.tenantId, userId, departmentId]);
      return client;
    };

    beforeAll(async () => {
      world = await seedTenant(db.platform);
      ({ admin: owner } = await adminOf(db, app, world));
      companyA = world.companyId;
      companyB = (await owner.post('/companies', { name: unique('B'), countryCode: 'CO' }).expect(201)).body.id;
      deptX = (await owner.post('/departments', { name: unique('X') }).expect(201)).body.id;
      deptY = (await owner.post('/departments', { name: unique('Y') }).expect(201)).body.id;
      await category('open');
      await category('onlyA', { companyIds: [companyA] });
      await category('onlyB', { companyIds: [companyB] });
      await category('onlyX', { departmentIds: [deptX] });
      await category('AandX', { companyIds: [companyA], departmentIds: [deptX] });
      await category('inactive', {}, { active: false });
      await category('filtered', {}, { subcategories: [{ name: 'kept' }, { name: 'off', active: false }] });
    });

    it('a user of company A and department X sees the open categories and those that include A and/or X', async () => {
      const client = await member([companyA], deptX);
      expect(await keysSeenBy(client)).toEqual(['AandX', 'filtered', 'onlyA', 'onlyX', 'open']);
    });

    it('a user of company B and department Y only sees what is open or for B', async () => {
      const client = await member([companyB], deptY);
      expect(await keysSeenBy(client)).toEqual(['filtered', 'onlyB', 'open']);
    });

    it('a user without department does not see the categories restricted by department', async () => {
      const client = await member([companyA]);
      expect(await keysSeenBy(client)).toEqual(['filtered', 'onlyA', 'open']);
    });

    it('a user of both companies sees both, or one when choosing the company', async () => {
      const client = await member([companyA, companyB], deptY);
      expect(await keysSeenBy(client)).toEqual(['filtered', 'onlyA', 'onlyB', 'open']);
      expect(await keysSeenBy(client, `?companyId=${companyB}`)).toEqual(['filtered', 'onlyB', 'open']);
    });

    it('refuses a company that is not one of the user\'s (422), also one of another tenant', async () => {
      const client = await member([companyA], deptX);
      await client.get(`/catalog/available?companyId=${companyB}`).expect(422);
      const other = await seedTenant(db.platform);
      await client.get(`/catalog/available?companyId=${other.companyId}`).expect(422);
    });

    it('lists only active subcategories, with their default priority', async () => {
      const client = await member([companyA], deptX);
      const { categories } = (await client.get('/catalog/available').expect(200)).body as { categories: Array<{ id: string; subcategories: Array<{ name: string }> }> };
      const filtered = categories.find((entry) => names[entry.id] === 'filtered')!;
      expect(filtered.subcategories.map((sub) => sub.name)).toEqual(['kept']);
    });
  });

  describe('error types and subtypes', () => {
    it('creates, reads, updates, lists, deactivates and reactivates a type, with its subtypes', async () => {
      const name = unique('Wrong amount');
      await admin.post('/error-types', { name: unique('Spare reopening'), isReopening: true }).expect(201);
      const created = (await admin.post('/error-types', { name, description: 'The amount does not match', isProcessError: true }).expect(201)).body;
      expect(created).toMatchObject({ name, isProcessError: true, forcesClose: false, isReopening: false, isActive: true });
      expect((await admin.get(`/error-types/${created.id}`).expect(200)).body.id).toBe(created.id);
      expect((await admin.patch(`/error-types/${created.id}`, { isReopening: true, description: null }).expect(200)).body).toMatchObject({ isReopening: true, description: null });

      const subtype = (await admin.post(`/error-types/${created.id}/subtypes`, { name: 'Typo' }).expect(201)).body;
      expect(subtype).toMatchObject({ errorTypeId: created.id, name: 'Typo', isActive: true });
      expect((await admin.patch(`/error-types/${created.id}/subtypes/${subtype.id}`, { description: 'Digits swapped' }).expect(200)).body.description).toBe('Digits swapped');
      expect((await admin.post(`/error-types/${created.id}/subtypes/${subtype.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.get(`/error-types/${created.id}/subtypes`).expect(200)).body.items).toEqual([]);
      expect((await admin.get(`/error-types/${created.id}/subtypes?includeInactive=true`).expect(200)).body.items.map((item: { id: string }) => item.id)).toEqual([subtype.id]);
      expect((await admin.post(`/error-types/${created.id}/subtypes/${subtype.id}/activate`).expect(200)).body.isActive).toBe(true);

      expect((await admin.post(`/error-types/${created.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      const listed = (await admin.get(`/error-types?pageSize=100&search=${encodeURIComponent(name)}`).expect(200)).body.items;
      expect(listed).toEqual([]);
      expect((await admin.post(`/error-types/${created.id}/activate`).expect(200)).body.isActive).toBe(true);
    });

    it('refuses a type that is both a reopening and forces the close, also when only one flag changes (400 / 422)', async () => {
      await admin.post('/error-types', { name: unique('Both'), isReopening: true, forcesClose: true }).expect(400);
      const created = (await admin.post('/error-types', { name: unique('Reopen'), isReopening: true }).expect(201)).body;
      await admin.patch(`/error-types/${created.id}`, { isReopening: true, forcesClose: true }).expect(400);
      expect((await admin.patch(`/error-types/${created.id}`, { forcesClose: true }).expect(422)).body.error.code).toBe('INVALID_STATE');
    });

    it('refuses repeated names (409), empty updates (400) and unknown ids (404)', async () => {
      const name = unique('Dup');
      const created = (await admin.post('/error-types', { name }).expect(201)).body;
      expect((await admin.post('/error-types', { name }).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.post(`/error-types/${created.id}/subtypes`, { name: 'same' }).expect(201);
      await admin.post(`/error-types/${created.id}/subtypes`, { name: 'same' }).expect(409);
      await admin.patch(`/error-types/${created.id}`, {}).expect(400);
      await admin.get('/error-types/0199a000-0000-7000-8000-0000000000aa').expect(404);
      await admin.post('/error-types/0199a000-0000-7000-8000-0000000000aa/subtypes', { name: 'x' }).expect(404);
    });

    it('keeps one active reopening type: the last one cannot be deactivated or turned into a plain type', async () => {
      const { admin: lone } = await adminOf(db, app, await seedTenant(db.platform));
      const only = (await lone.post('/error-types', { name: unique('Only'), isReopening: true }).expect(201)).body.id as string;
      expect((await lone.post(`/error-types/${only}/deactivate`).expect(409)).body.error.code).toBe('LAST_REOPENING_TYPE');
      expect((await lone.patch(`/error-types/${only}`, { isReopening: false }).expect(409)).body.error.code).toBe('LAST_REOPENING_TYPE');
      expect((await lone.patch(`/error-types/${only}`, { name: unique('Renamed') }).expect(200)).body.isActive).toBe(true);

      const second = (await lone.post('/error-types', { name: unique('Second'), isReopening: true }).expect(201)).body.id as string;
      await lone.post(`/error-types/${only}/deactivate`).expect(200);
      await lone.post(`/error-types/${second}/deactivate`).expect(409);
      await lone.post(`/error-types/${only}/activate`).expect(200);
      await lone.post(`/error-types/${second}/deactivate`).expect(200);
    });

    it('two deactivations at once leave one reopening type', async () => {
      const { admin: pair } = await adminOf(db, app, await seedTenant(db.platform));
      const first = (await pair.post('/error-types', { name: unique('First'), isReopening: true }).expect(201)).body.id as string;
      const second = (await pair.post('/error-types', { name: unique('Other'), isReopening: true }).expect(201)).body.id as string;
      const results = await Promise.all([pair.post(`/error-types/${first}/deactivate`), pair.post(`/error-types/${second}/deactivate`)]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    });

    it('needs the ErrorType permissions', async () => {
      const reader = await clientWith(db, app, tenant, [{ action: 'read', subject: 'ErrorType' }]);
      await reader.get('/error-types').expect(200);
      await reader.post('/error-types', { name: unique('No') }).expect(403);
      const nobody = await clientWith(db, app, tenant, []);
      await nobody.get('/error-types').expect(403);
    });

    it('another tenant sees none of it and cannot change it', async () => {
      const created = (await admin.post('/error-types', { name: unique('Mine') }).expect(201)).body;
      const subtype = (await admin.post(`/error-types/${created.id}/subtypes`, { name: 'mine' }).expect(201)).body;
      const { admin: stranger } = await adminOf(db, app, await seedTenant(db.platform));
      expect((await stranger.get('/error-types?pageSize=100').expect(200)).body.items.map((item: { id: string }) => item.id)).not.toContain(created.id);
      await stranger.get(`/error-types/${created.id}`).expect(404);
      await stranger.patch(`/error-types/${created.id}`, { name: 'taken' }).expect(404);
      await stranger.post(`/error-types/${created.id}/deactivate`).expect(404);
      await stranger.get(`/error-types/${created.id}/subtypes`).expect(404);
      await stranger.post(`/error-types/${created.id}/subtypes`, { name: 'intruder' }).expect(404);
      await stranger.patch(`/error-types/${created.id}/subtypes/${subtype.id}`, { name: 'taken' }).expect(404);
      expect((await admin.get(`/error-types/${created.id}`).expect(200)).body.isActive).toBe(true);
    });
  });
});
