import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedTenant, type SeededTenant, withPlatformTransaction } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientOf, connectTestDatabase } from '../support/admin-api.js';
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
});
