import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SeededTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, type ApiClient, clientWith, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

interface Row {
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

describe('administrative actions are audited in the same transaction', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: ApiClient;
  let tenant: SeededTenant;

  /** The audit rows of one action in this tenant, oldest first. */
  const rows = async (action: string, entityId?: string): Promise<Row[]> =>
    (
      await db.owner.query<Row>(
        `SELECT action, entity_type, entity_id, actor_id, before, after FROM audit_logs
         WHERE tenant_id = $1 AND action = $2 AND ($3::uuid IS NULL OR entity_id = $3::uuid) ORDER BY id`,
        [tenant.tenantId, action, entityId ?? null],
      )
    ).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    ({ admin, tenant } = await adminOf(db, app));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('roles: created, updated, deactivated, activated, permissions replaced and deleted', async () => {
    const role = (await admin.post('/roles', { name: unique('Auditor') }).expect(201)).body;
    expect(await rows('role.created', role.id)).toEqual([expect.objectContaining({ entity_type: 'Role', actor_id: expect.any(String), after: expect.objectContaining({ name: role.name, isAdmin: false }) })]);

    await admin.patch(`/roles/${role.id}`, { name: `${role.name} v2` }).expect(200);
    expect((await rows('role.updated', role.id))[0]).toMatchObject({ before: { name: role.name }, after: { name: `${role.name} v2` } });
    await admin.post(`/roles/${role.id}/deactivate`).expect(200);
    await admin.post(`/roles/${role.id}/activate`).expect(200);
    expect(await rows('role.deactivated', role.id)).toHaveLength(1);
    expect(await rows('role.activated', role.id)).toHaveLength(1);

    await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }] }).expect(200);
    await admin.put(`/roles/${role.id}/permissions`, { permissions: [{ action: 'read', subject: 'Company' }, { action: 'update', subject: 'Group' }] }).expect(200);
    const replaced = await rows('role.permissions_replaced', role.id);
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toMatchObject({ before: [], after: ['read Company'] });
    expect(replaced[1]).toMatchObject({ before: ['read Company'], after: ['read Company', 'update Group'] });

    await admin.delete(`/roles/${role.id}`).expect(204);
    expect((await rows('role.deleted', role.id))[0]).toMatchObject({ before: expect.objectContaining({ name: `${role.name} v2` }) });
  });

  it('members: invited, resent, updated, deactivated and reactivated; no e-mail address is kept in the trail', async () => {
    const roleId = (await admin.post('/roles', { name: unique('Staff') }).expect(201)).body.id as string;
    const email = `${unique('person')}@example.com`;
    const invited = (await admin.post('/members/invitations', { email, firstName: 'Nina', lastName: 'Newhire', roleId, companyIds: [tenant.companyId] }).expect(201)).body;
    const invitedRow = (await rows('member.invited', invited.userId))[0]!;
    expect(invitedRow).toMatchObject({ entity_type: 'Membership', after: { roleId, companyIds: [tenant.companyId] } });
    expect(JSON.stringify(invitedRow)).not.toContain(email);

    await admin.post(`/members/${invited.userId}/resend-invitation`).expect(200);
    expect(await rows('member.invitation_resent', invited.userId)).toHaveLength(1);

    await admin.patch(`/members/${invited.userId}`, { departmentId: null }).expect(200);
    expect((await rows('member.updated', invited.userId))[0]).toMatchObject({ before: { roleId }, after: { roleId } });
    await admin.post(`/members/${invited.userId}/deactivate`).expect(200);
    expect((await rows('member.deactivated', invited.userId))[0]).toMatchObject({ before: { status: 'INVITED' }, after: { status: 'INACTIVE' } });
    await admin.post(`/members/${invited.userId}/activate`).expect(200);
    expect(await rows('member.reactivated', invited.userId)).toHaveLength(1);
  });

  it('groups and approval groups: lifecycle and membership changes', async () => {
    const group = (await admin.post('/groups', { name: unique('Group') }).expect(201)).body;
    await admin.patch(`/groups/${group.id}`, { name: `${group.name}!` }).expect(200);
    await admin.put(`/groups/${group.id}/members`, { userIds: [tenant.userId] }).expect(200);
    await admin.delete(`/groups/${group.id}/members/${tenant.userId}`).expect(204);
    await admin.post(`/groups/${group.id}/members`, { userId: tenant.userId }).expect(201);
    await admin.post(`/groups/${group.id}/deactivate`).expect(200);
    await admin.post(`/groups/${group.id}/activate`).expect(200);
    for (const action of ['group.created', 'group.updated', 'group.members_replaced', 'group.member_removed', 'group.member_added', 'group.deactivated', 'group.activated']) {
      expect((await rows(action, group.id)).length, action).toBe(1);
    }

    const type = (await admin.post('/approval-group-types', { name: unique('Type') }).expect(201)).body;
    await admin.patch(`/approval-group-types/${type.id}`, { name: `${type.name}!` }).expect(200);
    const approvalGroup = (await admin.post('/approval-groups', { typeId: type.id, name: unique('Approvers') }).expect(201)).body;
    await admin.put(`/approval-groups/${approvalGroup.id}/members`, { userIds: [tenant.userId] }).expect(200);
    await admin.put(`/approval-groups/${approvalGroup.id}/approvers`, { userIds: [tenant.userId] }).expect(200);
    await admin.post(`/approval-groups/${approvalGroup.id}/deactivate`).expect(200);
    for (const action of ['approval_group.created', 'approval_group.members_replaced', 'approval_group.approvers_replaced', 'approval_group.deactivated']) {
      expect((await rows(action, approvalGroup.id)).length, action).toBe(1);
    }
    expect(await rows('approval_group_type.created', type.id)).toHaveLength(1);
    expect(await rows('approval_group_type.updated', type.id)).toHaveLength(1);
    await admin.delete(`/approval-group-types/${type.id}`).expect(422);
    expect(await rows('approval_group_type.deleted', type.id)).toEqual([]);
  });

  it('workflows: created, renamed and published (draft edits are not audited)', async () => {
    const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategory = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await admin.post('/workflows', { subcategoryId: subcategory, name: unique('Flow') }).expect(201)).body;
    expect((await rows('workflow.created', workflow.id))[0]).toMatchObject({ entity_type: 'Workflow', after: { name: workflow.name, subcategoryId: subcategory } });
    await admin.patch(`/workflows/${workflow.id}`, { name: `${workflow.name}!` }).expect(200);
    expect((await rows('workflow.updated', workflow.id))[0]).toMatchObject({ before: { name: workflow.name }, after: { name: `${workflow.name}!` } });

    const versionId = workflow.versions[0].id as string;
    await admin.post(`/workflows/${workflow.id}/versions/${versionId}/publish`, {}).expect(200);
    expect((await rows('workflow.version_published', workflow.id))[0]).toMatchObject({ after: { versionId, number: 1 } });
  });

  it('the calculator configuration: updated and removed, with the parameters in the trail', async () => {
    const meals = { meals: [{ code: 'LUNCH', from: '12:00', to: '14:00', amount: '15000.50' }] };
    await admin.put('/calculators/MEAL_ALLOWANCE/config', meals).expect(200);
    await admin.delete('/calculators/MEAL_ALLOWANCE/config').expect(200);
    const updated = (await rows('calculator.config_updated'))[0]!;
    expect(updated.after).toEqual({ calculator: 'MEAL_ALLOWANCE', config: meals });
    expect((await rows('calculator.config_removed'))[0]!.before).toMatchObject({ calculator: 'MEAL_ALLOWANCE' });
  });

  it('an action refused by the database leaves no row (same transaction)', async () => {
    const before = (await rows('role.created')).length;
    await admin.post('/roles', { name: unique('Boom'), isAdmin: 'yes' }).expect(400);
    const limited = await clientWith(db, app, tenant, [{ action: 'create', subject: 'Role' }]);
    await limited.post('/roles', { name: unique('Escalate'), isAdmin: true }).then((response) => expect(response.status).toBeGreaterThanOrEqual(400));
    expect((await rows('role.created')).length).toBe(before);
  });

  it('a member without the permission to change the thing cannot leave a row either', async () => {
    const reader = await clientWith(db, app, tenant, [{ action: 'read', subject: 'Role' }]);
    const before = (await rows('role.created')).length;
    await reader.post('/roles', { name: unique('Nope') }).expect(403);
    expect((await rows('role.created')).length).toBe(before);
  });
});
