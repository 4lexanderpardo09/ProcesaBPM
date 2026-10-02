import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, ApiClient, clientOf, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker, tokenOf } from '../support/worker-mail.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;
const emailOf = () => `${unique('person')}@example.com`;
const PASSWORD = 'a brand new password 123';

interface InvitationEvent {
  readonly payload: { userId: string; tenantId: string };
}

describe('identity API: members', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;
  let staffRoleId: string;
  let mail: MailWorker;

  const http = () => request(app.getHttpServer());
  const invite = (overrides: object = {}) =>
    admin.post('/members/invitations', { email: emailOf(), firstName: 'Nina', lastName: 'Newhire', roleId: staffRoleId, companyIds: [tenant.companyId], ...overrides });
  const events = async (userId: string): Promise<InvitationEvent[]> =>
    (await db.owner.query<InvitationEvent>(`SELECT payload FROM platform_outbox_events WHERE type = 'email.invitation' AND payload ->> 'userId' = $1 ORDER BY created_at`, [userId])).rows;

  /** Lets the worker deliver what is queued and returns the token of the newest link mailed to the address. */
  const linkTokenFor = async (email: string): Promise<string> => {
    await mail.deliver({ retries: true });
    return tokenOf(mail.lastTo(email)!);
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    ({ admin, tenant } = await adminOf(db, app));
    staffRoleId = (await admin.post('/roles', { name: unique('Staff') }).expect(201)).body.id;
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('invitations', () => {
    it('invites, the person accepts with a password, logs in and sees the organization', async () => {
      const email = emailOf();
      const invited = (await invite({ email }).expect(201)).body;
      expect(invited).toMatchObject({ status: 'INVITED', email, isOwner: false, roleId: staffRoleId, companyIds: [tenant.companyId], joinedAt: null });

      const [event] = await events(invited.userId);
      expect(event!.payload).toEqual({ userId: invited.userId, tenantId: tenant.tenantId });
      const message = await mail.waitForMail(email);
      expect(message.subject).toBe('Te invitaron a ProcesaBPM');
      await http().post('/auth/invitations/accept').send({ token: tokenOf(message), password: PASSWORD }).expect(200);
      // Selection tokens issued in the same second as the password change are refused (iat has whole seconds).
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const session = await signIn(app, email, tenant.tenantId, PASSWORD);
      const me = await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body.user.email).toBe(email);
      expect((await admin.get(`/members/${invited.userId}`).expect(200)).body).toMatchObject({ status: 'ACTIVE' });
    });

    it('a person who is already a member answers 409, an unknown role or company 422, and no company 400', async () => {
      const email = emailOf();
      await invite({ email }).expect(201);
      expect((await invite({ email }).expect(409)).body.error.code).toBe('DUPLICATE');
      await invite({ roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);
      await invite({ companyIds: ['018f3c1e-7b2a-7c3d-9e4f-0123456789ab'] }).expect(422);
      await invite({ companyIds: [] }).expect(400);
    });

    it('a failed invitation leaves nothing behind (no identity, no event)', async () => {
      const email = emailOf();
      await invite({ email, roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);
      expect((await db.owner.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount).toBe(0);
    });

    it('resending invalidates the earlier links: only the newest one can be accepted', async () => {
      const email = emailOf();
      const invited = (await invite({ email }).expect(201)).body;
      const first = await linkTokenFor(email);
      await admin.post(`/members/${invited.userId}/resend-invitation`).expect(200);
      const second = await linkTokenFor(email);
      expect((await http().post('/auth/invitations/accept').send({ token: first, password: PASSWORD }).expect(400)).body.error.code).toBe('INVALID_TOKEN');
      await http().post('/auth/invitations/accept').send({ token: second, password: PASSWORD }).expect(200);
    });

    it('resends a pending invitation with a new link and refuses it once accepted', async () => {
      const email = emailOf();
      const invited = (await invite({ email }).expect(201)).body;
      const first = await linkTokenFor(email);
      await admin.post(`/members/${invited.userId}/resend-invitation`).expect(200);
      expect(await events(invited.userId)).toHaveLength(2);
      const second = await linkTokenFor(email);
      expect(second).not.toBe(first);
      await http().post('/auth/invitations/accept').send({ token: second, password: PASSWORD }).expect(200);
      expect((await admin.post(`/members/${invited.userId}/resend-invitation`).expect(422)).body.error.code).toBe('INVALID_STATE');
    });

    it('an existing person of another organization is invited without changing their password', async () => {
      const other = await seedTenant(db.platform);
      const { rows } = await db.platform.query<{ email: string; user_id: string }>(`SELECT u.email, u.id AS user_id FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = $1 LIMIT 1`, [other.tenantId]);
      const before = (await db.owner.query('SELECT password_hash FROM users WHERE id = $1', [rows[0]!.user_id])).rows;
      const invited = (await invite({ email: rows[0]!.email }).expect(201)).body;
      expect(invited.userId).toBe(rows[0]!.user_id);
      expect((await db.owner.query('SELECT password_hash FROM users WHERE id = $1', [rows[0]!.user_id])).rows).toEqual(before);
    });
  });

  describe('listing and editing', () => {
    it('lists with filters by role, position, department, site, status and text', async () => {
      const position = (await admin.post('/positions', { name: unique('Pos') }).expect(201)).body.id;
      const department = (await admin.post('/departments', { name: unique('Dept') }).expect(201)).body.id;
      const site = (await admin.post('/sites', { name: unique('Site') }).expect(201)).body.id;
      const role = (await admin.post('/roles', { name: unique('Filter role') }).expect(201)).body.id;
      const tag = unique('Zed').toLowerCase();
      const target = (await invite({ email: `${tag}@example.com`, firstName: 'Zedd', lastName: tag, roleId: role, positionId: position, departmentId: department, siteId: site }).expect(201)).body;
      await invite().expect(201);

      const ids = async (query: string) => ((await admin.get(`/members?${query}&pageSize=100`).expect(200)).body.items as Array<{ userId: string }>).map((item) => item.userId);
      expect(await ids(`roleId=${role}`)).toEqual([target.userId]);
      expect(await ids(`positionId=${position}`)).toEqual([target.userId]);
      expect(await ids(`departmentId=${department}`)).toEqual([target.userId]);
      expect(await ids(`siteId=${site}`)).toEqual([target.userId]);
      expect(await ids(`search=${tag.toUpperCase()}`)).toEqual([target.userId]);
      expect(await ids(`search=${tag}&status=INVITED`)).toEqual([target.userId]);
      expect(await ids(`search=${tag}&status=ACTIVE`)).toEqual([]);
    });

    it('edits role, position, department, site and companies; the member keeps at least one company', async () => {
      const member = (await invite().expect(201)).body;
      const second = (await admin.post('/companies', { name: unique('Second'), countryCode: 'CO' }).expect(201)).body.id;
      const position = (await admin.post('/positions', { name: unique('P') }).expect(201)).body.id;
      const edited = (await admin.patch(`/members/${member.userId}`, { positionId: position, companyIds: [second] }).expect(200)).body;
      expect(edited).toMatchObject({ positionId: position, companyIds: [second] });
      expect((await admin.patch(`/members/${member.userId}`, { positionId: null }).expect(200)).body.positionId).toBeNull();
      await admin.patch(`/members/${member.userId}`, { companyIds: [] }).expect(400);
      await admin.patch(`/members/${member.userId}`, {}).expect(400);
      await admin.patch(`/members/${member.userId}`, { companyIds: [tenant.companyId, second] }).expect(200);
      await admin.patch(`/members/${member.userId}`, { departmentId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' }).expect(422);
    });

    it('deactivates and reactivates; nobody deactivates themselves', async () => {
      const member = (await invite().expect(201)).body;
      const { rows } = await db.platform.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [member.userId]);
      await http().post('/auth/invitations/accept').send({ token: await linkTokenFor(rows[0]!.email), password: PASSWORD }).expect(200);
      expect(rows).toHaveLength(1);

      expect((await admin.post(`/members/${member.userId}/deactivate`).expect(200)).body.status).toBe('INACTIVE');
      expect((await admin.post(`/members/${member.userId}/deactivate`).expect(422)).body.error.code).toBe('INVALID_STATE');
      expect((await admin.post(`/members/${member.userId}/activate`).expect(200)).body.status).toBe('ACTIVE');
      expect((await admin.post(`/members/${member.userId}/activate`).expect(422)).body.error.code).toBe('INVALID_STATE');

      const { rows: self } = await db.platform.query<{ user_id: string }>(`SELECT user_id FROM memberships WHERE tenant_id = $1 AND role_id = $2 AND status = 'ACTIVE' LIMIT 1`, [tenant.tenantId, tenant.roleId]);
      const selfClient = await clientOf(db, app, tenant);
      const mine = (await selfClient.get('/auth/me').expect(200)).body.user.id as string;
      await selfClient.post(`/members/${mine}/deactivate`).expect(422);
      expect(self.length).toBeGreaterThan(0);
    });

    it('a member who never accepted goes back to INVITED when reactivated, never straight to ACTIVE', async () => {
      const member = (await invite().expect(201)).body;
      await admin.post(`/members/${member.userId}/deactivate`).expect(200);
      expect((await admin.post(`/members/${member.userId}/activate`).expect(200)).body.status).toBe('INVITED');
    });

    it('lists deactivated members only when asked', async () => {
      const tag = unique('gone').toLowerCase();
      const member = (await invite({ email: `${tag}@example.com`, lastName: tag }).expect(201)).body;
      await admin.post(`/members/${member.userId}/deactivate`).expect(200);
      expect((await admin.get(`/members?search=${tag}`).expect(200)).body.total).toBe(0);
      expect((await admin.get(`/members?search=${tag}&includeInactive=true`).expect(200)).body.total).toBe(1);
      expect((await admin.get(`/members?search=${tag}&status=INACTIVE`).expect(200)).body.total).toBe(1);
    });
  });

  describe('owner and admin rules through the API (typed errors, never 500)', () => {
    let world: SeededTenant;
    let owner: ApiClient;
    let ownerId: string;
    let staff: string;

    beforeAll(async () => {
      world = await seedTenant(db.platform);
      await db.platform.query('UPDATE memberships SET is_owner = true, joined_at = now() WHERE tenant_id = $1 AND user_id = $2', [world.tenantId, world.userId]);
      ({ admin: owner } = await adminOf(db, app, world));
      ownerId = world.userId;
      staff = (await owner.post('/roles', { name: unique('Plain') }).expect(201)).body.id;
    });

    it('the owner cannot be deactivated, nor lose the admin role', async () => {
      const other = await clientOf(db, app, world);
      const deactivate = await other.post(`/members/${ownerId}/deactivate`).expect(422);
      expect(deactivate.body.error.code).toBe('INVALID_STATE');
      const demote = await other.patch(`/members/${ownerId}`, { roleId: staff }).expect(422);
      expect(demote.body.error.code).toBe('INVALID_STATE');
      expect((await owner.get(`/members/${ownerId}`).expect(200)).body).toMatchObject({ status: 'ACTIVE', roleId: world.roleId });
    });

    it('the admin role cannot be deactivated or stripped while the owner holds it', async () => {
      const deactivate = await owner.post(`/roles/${world.roleId}/deactivate`).expect(422);
      expect(deactivate.body.error.code).toBe('INVALID_STATE');
      const stripped = await owner.patch(`/roles/${world.roleId}`, { isAdmin: false }).expect(422);
      expect(stripped.body.error.code).toBe('INVALID_STATE');
    });

    it('a non-admin cannot bring back a deactivated invitation of an admin, nor take a role that holds manage all (403)', async () => {
      const manager = await clientWith(db, app, world, [{ action: 'update', subject: 'Membership' }, { action: 'read', subject: 'Membership' }], unique('Reviver'));
      const adminInvite = (await owner.post('/members/invitations', { email: emailOf(), firstName: 'A', lastName: 'A', roleId: world.roleId, companyIds: [world.companyId] }).expect(201)).body;
      await owner.post(`/members/${adminInvite.userId}/deactivate`).expect(200);
      expect((await manager.post(`/members/${adminInvite.userId}/activate`).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
      expect((await owner.get(`/members/${adminInvite.userId}`).expect(200)).body.status).toBe('INACTIVE');

      const powerful = (await owner.post('/roles', { name: unique('Powerful') }).expect(201)).body.id;
      await owner.put(`/roles/${powerful}/permissions`, { permissions: [{ action: 'manage', subject: 'all' }] }).expect(200);
      const target = (await owner.post('/members/invitations', { email: emailOf(), firstName: 'T', lastName: 'T', roleId: staff, companyIds: [world.companyId] }).expect(201)).body;
      await manager.patch(`/members/${target.userId}`, { roleId: powerful }).expect(403);
    });

    it('inviting an existing person echoes the names sent, not the ones registered elsewhere', async () => {
      const other = await seedTenant(db.platform);
      const { rows } = await db.platform.query<{ email: string }>(`SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = $1 LIMIT 1`, [other.tenantId]);
      const invited = (await owner.post('/members/invitations', { email: rows[0]!.email, firstName: 'Sent', lastName: 'Names', roleId: staff, companyIds: [world.companyId] }).expect(201)).body;
      expect(invited).toMatchObject({ firstName: 'Sent', lastName: 'Names' });
    });

    it('lowering an administrator (deactivating, or taking them off the admin role) needs full access (403)', async () => {
      const manager = await clientWith(db, app, world, [{ action: 'update', subject: 'Membership' }, { action: 'delete', subject: 'Membership' }, { action: 'read', subject: 'Membership' }], unique('Demoter'));
      const second = await clientOf(db, app, world);
      const secondId = (await second.get('/auth/me').expect(200)).body.user.id as string;
      expect((await manager.post(`/members/${secondId}/deactivate`).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
      await manager.patch(`/members/${secondId}`, { roleId: staff }).expect(403);
      expect((await owner.get(`/members/${secondId}`).expect(200)).body).toMatchObject({ status: 'ACTIVE', roleId: world.roleId });
      // Changing something else about an administrator, or lowering a plain member, is fine.
      await manager.patch(`/members/${secondId}`, { positionId: null }).expect(200);
      const plain = (await owner.post('/members/invitations', { email: emailOf(), firstName: 'P', lastName: 'P', roleId: staff, companyIds: [world.companyId] }).expect(201)).body;
      await manager.post(`/members/${plain.userId}/deactivate`).expect(200);
      await owner.post(`/members/${secondId}/deactivate`).expect(200);
    });

    it('a member who can edit memberships but is not an administrator cannot hand out an admin role (403)', async () => {
      const manager = await clientWith(db, app, world, [{ action: 'update', subject: 'Membership' }, { action: 'create', subject: 'Membership' }, { action: 'read', subject: 'Membership' }], unique('Manager'));
      const target = (await owner.post('/members/invitations', { email: emailOf(), firstName: 'T', lastName: 'T', roleId: staff, companyIds: [world.companyId] }).expect(201)).body;
      const denied = await manager.patch(`/members/${target.userId}`, { roleId: world.roleId }).expect(403);
      expect(denied.body.error.code).toBe('PERMISSION_DENIED');
      await manager.post('/members/invitations', { email: emailOf(), firstName: 'T', lastName: 'T', roleId: world.roleId, companyIds: [world.companyId] }).expect(403);
      expect((await owner.get(`/members/${target.userId}`).expect(200)).body.roleId).toBe(staff);
    });

    it('a member who can edit roles but is not an administrator cannot create an admin role or grant manage all (403)', async () => {
      const editor = await clientWith(db, app, world, [{ action: 'update', subject: 'Role' }, { action: 'create', subject: 'Role' }, { action: 'read', subject: 'Role' }], unique('RoleEditor'));
      await editor.post('/roles', { name: unique('Sneaky'), isAdmin: true }).expect(403);
      const mine = (await editor.post('/roles', { name: unique('Mine') }).expect(201)).body.id;
      await editor.patch(`/roles/${mine}`, { isAdmin: true }).expect(403);
      await editor.put(`/roles/${mine}/permissions`, { permissions: [{ action: 'manage', subject: 'all' }] }).expect(403);
      await owner.put(`/roles/${mine}/permissions`, { permissions: [{ action: 'manage', subject: 'all' }] }).expect(200);
    });

    it('the ownership cannot be taken through the API: isOwner is not an accepted field and the flag is untouched', async () => {
      const other = await clientOf(db, app, world);
      await other.patch(`/members/${ownerId}`, { isOwner: true }).expect(400);
      const { rows } = await db.owner.query('SELECT user_id FROM memberships WHERE tenant_id = $1 AND is_owner', [world.tenantId]);
      expect(rows).toEqual([{ user_id: ownerId }]);
    });
  });
});

describe('identity API: roles, permissions and groups', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;
  let mail: MailWorker;
  const linkTokenFor = async (email: string): Promise<string> => {
    await mail.deliver({ retries: true });
    return tokenOf(mail.lastTo(email)!);
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
    mail = await MailWorker.start();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('roles', () => {
    it('creates, edits, toggles and lists roles', async () => {
      const tag = unique('role').toLowerCase();
      const role = (await admin.post('/roles', { name: `${tag}-a`, description: 'Does things' }).expect(201)).body;
      expect(role).toMatchObject({ systemRole: null, isAdmin: false, isActive: true, description: 'Does things' });
      expect((await admin.patch(`/roles/${role.id}`, { name: `${tag}-b`, description: null }).expect(200)).body).toMatchObject({ name: `${tag}-b`, description: null });
      expect((await admin.post(`/roles/${role.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.get(`/roles?search=${tag}`).expect(200)).body.total).toBe(0);
      expect((await admin.get(`/roles?search=${tag}&includeInactive=true`).expect(200)).body.total).toBe(1);
      expect((await admin.post(`/roles/${role.id}/activate`).expect(200)).body.isActive).toBe(true);
      expect((await admin.post('/roles', { name: `${tag}-b` }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('base roles (system_role) and roles with members cannot be deleted; others can', async () => {
      const base = (await admin.post('/roles', { name: unique('Base') }).expect(201)).body;
      await db.platform.query(`UPDATE roles SET system_role = 'AGENT' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, base.id]);
      expect((await admin.delete(`/roles/${base.id}`).expect(422)).body.error.code).toBe('INVALID_STATE');

      const used = (await admin.post('/roles', { name: unique('Used') }).expect(201)).body;
      await admin.post('/members/invitations', { email: emailOf(), firstName: 'U', lastName: 'U', roleId: used.id, companyIds: [tenant.companyId] }).expect(201);
      expect((await admin.delete(`/roles/${used.id}`).expect(422)).body.error.code).toBe('INVALID_STATE');

      const free = (await admin.post('/roles', { name: unique('Free') }).expect(201)).body;
      await admin.delete(`/roles/${free.id}`).expect(204);
      await admin.get(`/roles/${free.id}`).expect(404);
    });
  });

  describe('permissions of a role', () => {
    it('replaces the whole list in one operation and returns it ordered', async () => {
      const role = (await admin.post('/roles', { name: unique('Perms') }).expect(201)).body;
      const first = (await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }, { action: 'create', subject: 'Company' }] }).expect(200)).body;
      expect(first).toEqual([
        { action: 'create', subject: 'Company', conditions: null },
        { action: 'read', subject: 'Company', conditions: null },
      ]);
      const second = (await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Department' }] }).expect(200)).body;
      expect(second).toEqual([{ action: 'read', subject: 'Department', conditions: null }]);
      expect((await admin.get(`/roles/${role.id}/permissions`).expect(200)).body).toEqual(second);
      expect((await admin.put(`/roles/${role.id}/permissions`, { permissions: [] }).expect(200)).body).toEqual([]);
    });

    it('refuses unknown permissions (422), repeats (400) and conditions on subjects that take none (422), keeping the old list', async () => {
      const role = (await admin.post('/roles', { name: unique('Strict') }).expect(201)).body;
      await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }] }).expect(200);
      expect((await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'fly', subject: 'Company' }] }).expect(422)).body.error.code).toBe('INVALID_REFERENCE');
      await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }, { action: 'read', subject: 'Company' }] }).expect(400);
      const bad = await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company', conditions: { name: 'x' } }] }).expect(422);
      expect(bad.body.error.code).toBe('INVALID_CONDITION');
      expect((await admin.get(`/roles/${role.id}/permissions`).expect(200)).body).toEqual([{ action: 'read', subject: 'Company', conditions: null }]);
    });

    it('the change reaches the members of the role on their next request (permissions version)', async () => {
      const role = (await admin.post('/roles', { name: unique('Live') }).expect(201)).body;
      const member = await clientWith(db, app, tenant, [], unique('unused'));
      expect(member).toBeDefined();
      const email = emailOf();
      const invited = (await admin.post('/members/invitations', { email, firstName: 'L', lastName: 'L', roleId: role.id, companyIds: [tenant.companyId] }).expect(201)).body;
      expect(invited.userId).toBeDefined();
      await request(app.getHttpServer()).post('/auth/invitations/accept').send({ token: await linkTokenFor(email), password: PASSWORD }).expect(200);
      // Selection tokens issued in the same second as the password change are refused (iat has whole seconds).
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const session = new ApiClient(app, (await signIn(app, email, tenant.tenantId, PASSWORD)).accessToken);

      await session.get('/companies').expect(403);
      await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }] }).expect(200);
      await session.get('/companies').expect(200);
      await admin.put(`/roles/${role.id}/permissions`, { permissions: [] }).expect(200);
      await session.get('/companies').expect(403);
    });

    it('GET /permissions groups the catalog by subject', async () => {
      const groups = (await admin.get('/permissions').expect(200)).body as Array<{ subject: string; acceptsConditions: boolean; actions: Array<{ action: string }> }>;
      const company = groups.find((group) => group.subject === 'Company')!;
      expect(company.actions.map((entry) => entry.action).sort()).toEqual(['create', 'delete', 'read', 'update']);
      expect(company.acceptsConditions).toBe(false);
      expect(groups.map((group) => group.subject)).toEqual([...groups.map((group) => group.subject)].sort((a, b) => a.localeCompare(b)));
      expect(groups.find((group) => group.subject === 'Ticket')!.actions.length).toBeGreaterThan(3);
    });
  });

  describe('groups', () => {
    it('creates, renames, toggles and lists', async () => {
      const tag = unique('group').toLowerCase();
      const group = (await admin.post('/groups', { name: `${tag}-a` }).expect(201)).body;
      expect((await admin.patch(`/groups/${group.id}`, { name: `${tag}-b` }).expect(200)).body.name).toBe(`${tag}-b`);
      expect((await admin.post(`/groups/${group.id}/deactivate`).expect(200)).body.isActive).toBe(false);
      expect((await admin.get(`/groups?search=${tag}`).expect(200)).body.total).toBe(0);
      expect((await admin.get(`/groups?search=${tag}&includeInactive=true`).expect(200)).body.total).toBe(1);
      expect((await admin.post('/groups', { name: `${tag}-b` }).expect(409)).body.error.code).toBe('DUPLICATE');
    });

    it('adds, removes and replaces members; a repeat is 409 and a stranger 422', async () => {
      const group = (await admin.post('/groups', { name: unique('Team') }).expect(201)).body;
      const people = [] as string[];
      for (let index = 0; index < 3; index += 1) {
        people.push((await admin.post('/members/invitations', { email: emailOf(), firstName: 'G', lastName: `${index}`, roleId: tenant.roleId, companyIds: [tenant.companyId] }).expect(201)).body.userId);
      }
      expect((await admin.post(`/groups/${group.id}/members`, { userId: people[0] }).expect(201)).body.userIds).toEqual([people[0]]);
      expect((await admin.post(`/groups/${group.id}/members`, { userId: people[0] }).expect(409)).body.error.code).toBe('DUPLICATE');
      const stranger = await seedTenant(db.platform);
      await admin.post(`/groups/${group.id}/members`, { userId: stranger.userId }).expect(422);
      expect((await admin.put(`/groups/${group.id}/members`, { userIds: [people[1], people[2]] }).expect(200)).body.userIds.sort()).toEqual([people[1], people[2]].sort());
      await admin.delete(`/groups/${group.id}/members/${people[1]}`).expect(204);
      await admin.delete(`/groups/${group.id}/members/${people[1]}`).expect(404);
      expect((await admin.get(`/groups/${group.id}/members`).expect(200)).body.userIds).toEqual([people[2]]);
      await admin.put(`/groups/${group.id}/members`, { userIds: [people[2], people[2]] }).expect(400);
    });
  });
});
