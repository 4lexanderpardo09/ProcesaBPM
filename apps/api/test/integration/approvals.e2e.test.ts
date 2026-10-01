import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedMember, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

describe('approvals API', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;
  let typeId: string;

  const person = () => seedMember(db.platform, tenant);
  const newGroup = async (overrides: { typeId?: string; companyId?: string; name?: string } = {}) =>
    (await admin.post('/approval-groups', { typeId: overrides.typeId ?? typeId, name: overrides.name ?? unique('Group'), ...(overrides.companyId === undefined ? {} : { companyId: overrides.companyId }) }).expect(201)).body.id as string;
  const configure = async (groupId: string, members: string[], approvers: string[]) => {
    await admin.put(`/approval-groups/${groupId}/members`, { userIds: members }).expect(200);
    await admin.put(`/approval-groups/${groupId}/approvers`, { userIds: approvers }).expect(200);
  };
  const resolve = (userId: string, query: { companyId?: string; level?: number; at?: string; typeId?: string } = {}) =>
    admin.get(`/approvals/resolve?userId=${userId}&typeId=${query.typeId ?? typeId}&companyId=${query.companyId ?? tenant.companyId}${query.level === undefined ? '' : `&level=${query.level}`}${query.at === undefined ? '' : `&at=${encodeURIComponent(query.at)}`}`);
  const meOf = async (client: ApiClient) => (await client.get('/auth/me').expect(200)).body.user.id as string;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
    typeId = (await admin.post('/approval-group-types', { name: unique('Purchases') }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('group types', () => {
    it('creates, renames, lists and deletes an unused type', async () => {
      const type = (await admin.post('/approval-group-types', { name: unique('Type') }).expect(201)).body;
      expect(type.isDefault).toBe(false);
      const renamed = unique('Renamed');
      expect((await admin.patch(`/approval-group-types/${type.id}`, { name: renamed }).expect(200)).body.name).toBe(renamed);
      expect((await admin.get(`/approval-group-types?search=${renamed}`).expect(200)).body.total).toBe(1);
      await admin.delete(`/approval-group-types/${type.id}`).expect(204);
      await admin.get(`/approval-group-types/${type.id}`).expect(404);
    });

    it('the default type and a type with groups are kept (422); a repeated name is 409', async () => {
      const defaultType = (await admin.post('/approval-group-types', { name: unique('Default') }).expect(201)).body;
      await db.platform.query('UPDATE approval_group_types SET is_default = true WHERE id = $1', [defaultType.id]);
      expect((await admin.delete(`/approval-group-types/${defaultType.id}`).expect(422)).body.error.code).toBe('INVALID_STATE');
      await db.platform.query('UPDATE approval_group_types SET is_default = false WHERE id = $1', [defaultType.id]);
      await newGroup();
      expect((await admin.delete(`/approval-group-types/${typeId}`).expect(422)).body.error.code).toBe('INVALID_STATE');
      expect((await admin.post('/approval-group-types', { name: defaultType.name }).expect(409)).body.error.code).toBe('DUPLICATE');
    });
  });

  describe('groups, approvers and members', () => {
    it('creates a group for a type (and optionally a company), lists with filters and toggles it', async () => {
      const company = (await admin.post('/companies', { name: unique('Co'), countryCode: 'CO' }).expect(201)).body.id;
      const general = await newGroup({ name: unique('General') });
      const scoped = await newGroup({ companyId: company, name: unique('Scoped') });
      expect((await admin.get(`/approval-groups/${general}`).expect(200)).body).toMatchObject({ typeId, companyId: null, isActive: true });
      expect((await admin.get(`/approval-groups/${scoped}`).expect(200)).body.companyId).toBe(company);
      expect(((await admin.get(`/approval-groups?typeId=${typeId}&companyId=${company}`).expect(200)).body.items as Array<{ id: string }>).map((g) => g.id)).toEqual([scoped]);
      expect((await admin.post(`/approval-groups/${scoped}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.get(`/approval-groups?companyId=${company}`).expect(200)).body.total).toBe(0);
      expect((await admin.post(`/approval-groups/${scoped}/activate`).expect(200)).body.isActive).toBe(true);
      expect((await admin.patch(`/approval-groups/${scoped}`, { name: unique('Renamed') }).expect(200)).body.isActive).toBe(true);
    });

    it('replaces and reorders the approvers in one operation; the list order is the position', async () => {
      const group = await newGroup();
      const [a, b, c] = [await person(), await person(), await person()];
      expect((await admin.put(`/approval-groups/${group}/approvers`, { userIds: [a, b, c] }).expect(200)).body.approvers).toEqual([
        { userId: a, position: 1 },
        { userId: b, position: 2 },
        { userId: c, position: 3 },
      ]);
      expect((await admin.put(`/approval-groups/${group}/approvers`, { userIds: [c, a] }).expect(200)).body.approvers).toEqual([
        { userId: c, position: 1 },
        { userId: a, position: 2 },
      ]);
      expect((await admin.get(`/approval-groups/${group}/approvers`).expect(200)).body.approvers).toHaveLength(2);
      await admin.put(`/approval-groups/${group}/approvers`, { userIds: [a, a] }).expect(400);
      await admin.put(`/approval-groups/${group}/approvers`, { userIds: [(await seedTenant(db.platform)).userId] }).expect(422);
      expect((await admin.get(`/approval-groups/${group}/approvers`).expect(200)).body.approvers).toHaveLength(2);
    });

    it('a person belongs to one group per (type, company): the second is 409; the general one next to a company one is fine', async () => {
      const company = (await admin.post('/companies', { name: unique('Co2'), countryCode: 'CO' }).expect(201)).body.id;
      const first = await newGroup({ companyId: company });
      const second = await newGroup({ companyId: company });
      const general = await newGroup();
      const member = await person();
      expect((await admin.post(`/approval-groups/${first}/members`, { userId: member }).expect(201)).body.userIds).toEqual([member]);
      expect((await admin.post(`/approval-groups/${second}/members`, { userId: member }).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.post(`/approval-groups/${general}/members`, { userId: member }).expect(201);
      expect((await admin.put(`/approval-groups/${second}/members`, { userIds: [member] }).expect(409)).body.error.code).toBe('DUPLICATE');
      await admin.delete(`/approval-groups/${first}/members/${member}`).expect(204);
      await admin.delete(`/approval-groups/${first}/members/${member}`).expect(404);
      await admin.post(`/approval-groups/${second}/members`, { userId: member }).expect(201);
    });

    it('refuses a type or company of another tenant, and a member who is not of the tenant (422)', async () => {
      const other = await seedTenant(db.platform);
      const { rows } = await db.platform.query<{ id: string }>(`INSERT INTO approval_group_types (tenant_id, name) VALUES ($1, 'Foreign') RETURNING id`, [other.tenantId]);
      await admin.post('/approval-groups', { typeId: rows[0]!.id, name: unique('X') }).expect(422);
      await admin.post('/approval-groups', { typeId, companyId: other.companyId, name: unique('X') }).expect(422);
      const group = await newGroup();
      await admin.post(`/approval-groups/${group}/members`, { userId: other.userId }).expect(422);
    });
  });

  describe('delegations', () => {
    let employee: ApiClient;
    let employeeId: string;
    let colleague: string;

    beforeAll(async () => {
      employee = await clientWith(db, app, tenant, [], unique('Plain'));
      employeeId = await meOf(employee);
      colleague = await person();
    });

    it('a member creates and lists their own delegation', async () => {
      const created = (await employee.post('/delegations', { toUserId: colleague, startsAt: inDays(1), endsAt: inDays(3), reason: 'Vacation' }).expect(201)).body;
      expect(created).toMatchObject({ fromUserId: employeeId, toUserId: colleague, reason: 'Vacation' });
      const mine = (await employee.get('/delegations').expect(200)).body.items as Array<{ id: string }>;
      expect(mine.map((item) => item.id)).toContain(created.id);
    });

    it('nobody delegates to themselves (400) or ends before starting (400)', async () => {
      await employee.post('/delegations', { toUserId: employeeId, startsAt: inDays(1), endsAt: inDays(2) }).expect(400);
      await employee.post('/delegations', { toUserId: colleague, startsAt: inDays(3), endsAt: inDays(2) }).expect(400);
    });

    it('a delegation that already ended cannot be created (400)', async () => {
      await employee.post('/delegations', { toUserId: colleague, startsAt: inDays(-3), endsAt: inDays(-2) }).expect(400);
    });

    it('overlapping delegations of the same person are 409; back-to-back ones are fine', async () => {
      const worker = await clientWith(db, app, tenant, [], unique('Worker'));
      await worker.post('/delegations', { toUserId: colleague, startsAt: inDays(10), endsAt: inDays(12) }).expect(201);
      expect((await worker.post('/delegations', { toUserId: colleague, startsAt: inDays(11), endsAt: inDays(13) }).expect(409)).body.error.code).toBe('OVERLAP');
      await worker.post('/delegations', { toUserId: colleague, startsAt: inDays(12), endsAt: inDays(14) }).expect(201);
    });

    it('circular delegations in the same period are 409', async () => {
      const a = await clientWith(db, app, tenant, [], unique('A'));
      const b = await clientWith(db, app, tenant, [], unique('B'));
      await a.post('/delegations', { toUserId: await meOf(b), startsAt: inDays(20), endsAt: inDays(22) }).expect(201);
      const response = await b.post('/delegations', { toUserId: await meOf(a), startsAt: inDays(21), endsAt: inDays(23) }).expect(409);
      expect(response.body.error.code).toBe('OVERLAP');
    });

    it('only whoever manages delegations creates or sees those of other people', async () => {
      await employee.post('/delegations', { fromUserId: colleague, toUserId: employeeId, startsAt: inDays(30), endsAt: inDays(31) }).expect(403);
      const created = (await admin.post('/delegations', { fromUserId: colleague, toUserId: employeeId, startsAt: inDays(30), endsAt: inDays(31) }).expect(201)).body;
      expect(created.fromUserId).toBe(colleague);
      const stranger = await clientWith(db, app, tenant, [], unique('Stranger'));
      expect(((await stranger.get('/delegations?pageSize=100').expect(200)).body.items as Array<{ id: string }>).map((item) => item.id)).not.toContain(created.id);
      expect(((await employee.get('/delegations?pageSize=100').expect(200)).body.items as Array<{ id: string }>).map((item) => item.id)).toContain(created.id);
      expect(((await admin.get(`/delegations?fromUserId=${colleague}&pageSize=100`).expect(200)).body.items as Array<{ id: string }>).map((item) => item.id)).toContain(created.id);
    });

    it('cancels: a future delegation is removed, one in force ends now, a finished one is 422, someone else\'s is 404', async () => {
      const employee = await clientWith(db, app, tenant, [], unique('Canceller'));
      const employeeId = await meOf(employee);
      const future = (await employee.post('/delegations', { toUserId: colleague, startsAt: inDays(40), endsAt: inDays(41) }).expect(201)).body;
      expect((await employee.post(`/delegations/${future.id}/cancel`).expect(200)).body).toEqual({ removed: true });
      expect((await db.owner.query('SELECT 1 FROM delegations WHERE id = $1', [future.id])).rowCount).toBe(0);

      const active = (await employee.post('/delegations', { toUserId: colleague, startsAt: inDays(-1), endsAt: inDays(5) }).expect(201)).body;
      const stranger = await clientWith(db, app, tenant, [], unique('Other'));
      await stranger.post(`/delegations/${active.id}/cancel`).expect(404);
      const ended = (await employee.post(`/delegations/${active.id}/cancel`).expect(200)).body;
      expect(new Date(ended.endsAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect((await employee.post(`/delegations/${active.id}/cancel`).expect(422)).body.error.code).toBe('INVALID_STATE');
      await employee.post(`/delegations/${active.id}/cancel`).expect(422);
    });
  });

  describe('GET /approvals/resolve', () => {
    let company: string;

    beforeAll(async () => {
      company = (await admin.post('/companies', { name: unique('Resolve Co'), countryCode: 'CO' }).expect(201)).body.id;
    });

    it('resolves the approver of the company group, falling back to the general group', async () => {
      const creator = await person();
      const companyBoss = await person();
      const generalBoss = await person();
      const general = await newGroup();
      await configure(general, [creator], [generalBoss]);
      expect((await resolve(creator, { companyId: company }).expect(200)).body).toMatchObject({ found: true, approverId: generalBoss, scope: 'GENERAL', level: 1, onBehalfOfId: null });

      const scoped = await newGroup({ companyId: company });
      await configure(scoped, [creator], [companyBoss, generalBoss]);
      const outcome = (await resolve(creator, { companyId: company }).expect(200)).body;
      expect(outcome).toMatchObject({ found: true, approverId: companyBoss, scope: 'COMPANY', groupId: scoped });
      expect(outcome.chain[0]).toMatchObject({ level: 1, subjectId: creator });
    });

    it('skips an approver who was deactivated and answers with the next one', async () => {
      const creator = await person();
      const first = await person();
      const second = await person();
      await configure(await newGroup({ companyId: company }), [creator], [first, second]);
      expect((await resolve(creator, { companyId: company }).expect(200)).body.approverId).toBe(first);
      await admin.post(`/members/${first}/deactivate`).expect(200);
      const outcome = (await resolve(creator, { companyId: company }).expect(200)).body;
      expect(outcome.approverId).toBe(second);
      expect(outcome.chain[0].groupsTried[0].skipped).toEqual([{ userId: first, reason: 'INACTIVE' }]);
    });

    it('uses the delegate while a delegation is in force at the instant, and not outside it', async () => {
      const creator = await person();
      const boss = await person();
      const delegate = await person();
      await configure(await newGroup({ companyId: company }), [creator], [boss]);
      await admin.post('/delegations', { fromUserId: boss, toUserId: delegate, startsAt: inDays(5), endsAt: inDays(8) }).expect(201);

      expect((await resolve(creator, { companyId: company }).expect(200)).body).toMatchObject({ approverId: boss, onBehalfOfId: null });
      expect((await resolve(creator, { companyId: company, at: inDays(6) }).expect(200)).body).toMatchObject({ approverId: delegate, onBehalfOfId: boss });
      expect((await resolve(creator, { companyId: company, at: inDays(8) }).expect(200)).body).toMatchObject({ approverId: boss, onBehalfOfId: null });
      // Seeing the delegations of another instant needs the right to see delegations.
      const reader = await clientWith(db, app, tenant, [{ action: 'read', subject: 'ApprovalGroup' }], unique('GroupReader'));
      await reader.get(`/approvals/resolve?userId=${creator}&typeId=${typeId}&companyId=${company}`).expect(200);
      await reader.get(`/approvals/resolve?userId=${creator}&typeId=${typeId}&companyId=${company}&at=${encodeURIComponent(inDays(6))}`).expect(403);
    });

    it('self-approval passes to the next approver, and with nobody else the answer explains why (200, found false)', async () => {
      const creator = await person();
      const deputy = await person();
      const group = await newGroup({ companyId: company });
      await configure(group, [creator], [creator, deputy]);
      expect((await resolve(creator, { companyId: company }).expect(200)).body.approverId).toBe(deputy);
      await admin.put(`/approval-groups/${group}/approvers`, { userIds: [creator] }).expect(200);
      const outcome = (await resolve(creator, { companyId: company }).expect(200)).body;
      expect(outcome).toMatchObject({ found: false, reason: 'SELF_APPROVAL_ONLY', level: 1, subjectId: creator });
    });

    it('several levels follow the chain, and a cycle ends instead of looping', async () => {
      const [creator, lead, manager] = [await person(), await person(), await person()];
      await configure(await newGroup({ companyId: company }), [creator], [lead]);
      await configure(await newGroup({ companyId: company }), [lead], [manager]);
      await configure(await newGroup({ companyId: company }), [manager], [lead]);
      expect((await resolve(creator, { companyId: company, level: 2 }).expect(200)).body.approverId).toBe(manager);
      const cycle = (await resolve(creator, { companyId: company, level: 3 }).expect(200)).body;
      expect(cycle).toMatchObject({ found: false, reason: 'APPROVAL_CYCLE', level: 3 });
      expect(cycle.chain).toHaveLength(3);
    });

    it('no group at all is NO_GROUP', async () => {
      expect((await resolve(await person(), { companyId: company }).expect(200)).body).toMatchObject({ found: false, reason: 'NO_GROUP' });
    });

    it('rejects a level outside 1..5 (400), and unknown or foreign ids (404)', async () => {
      const creator = await person();
      await resolve(creator, { level: 6 }).expect(400);
      await resolve(creator, { level: 0 }).expect(400);
      await resolve('018f3c1e-7b2a-7c3d-9e4f-0123456789ab').expect(404);
      await resolve(creator, { typeId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(404);
      const other = await seedTenant(db.platform);
      await resolve(other.userId).expect(404);
      await resolve(creator, { companyId: other.companyId }).expect(404);
    });
  });

  describe('tenant isolation', () => {
    it('another tenant cannot read or change types, groups, approvers, members or delegations by id', async () => {
      const { admin: stranger } = await adminOf(db, app);
      const group = await newGroup();
      const member = await person();
      await admin.post(`/approval-groups/${group}/members`, { userId: member }).expect(201);
      const delegation = (await admin.post('/delegations', { fromUserId: member, toUserId: tenant.userId, startsAt: inDays(50), endsAt: inDays(51) }).expect(201)).body;

      await stranger.get(`/approval-group-types/${typeId}`).expect(404);
      await stranger.patch(`/approval-group-types/${typeId}`, { name: 'hijacked' }).expect(404);
      await stranger.delete(`/approval-group-types/${typeId}`).expect(404);
      for (const path of [`/approval-groups/${group}`, `/approval-groups/${group}/approvers`, `/approval-groups/${group}/members`]) await stranger.get(path).expect(404);
      await stranger.patch(`/approval-groups/${group}`, { name: 'hijacked' }).expect(404);
      await stranger.put(`/approval-groups/${group}/approvers`, { userIds: [] }).expect(404);
      await stranger.post(`/approval-groups/${group}/deactivate`).expect(404);
      await stranger.post(`/delegations/${delegation.id}/cancel`).expect(404);
      expect(((await stranger.get('/delegations?pageSize=100').expect(200)).body.items as Array<{ id: string }>).map((item) => item.id)).not.toContain(delegation.id);
      expect((await admin.get(`/approval-groups/${group}`).expect(200)).body.name).not.toBe('hijacked');
    });
  });
});
