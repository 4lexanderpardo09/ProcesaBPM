import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { enableMfa, logInWithMfa } from '../support/mfa-fixtures.js';
import { grantEverything, seedRole } from '../support/permission-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

interface AuditItem {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

describe('audit log', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const http = () => request(app.getHttpServer());
  const logs = (accessToken: string, query: Record<string, string | number> = {}) => http().get('/audit-logs').query(query).set(bearer(accessToken));

  /** An administrator whose session passed the second factor (so the security policy can be changed). */
  async function verifiedAdmin(tenant: SeededTenant) {
    const user = await seedUser(db, tenant);
    const mfa = await enableMfa(db, user.userId);
    const selection = await logInWithMfa(app, db, user, mfa);
    const session = await http().post('/auth/select-tenant').set(bearer(selection)).send({ tenantId: tenant.tenantId }).expect(200);
    return { user, mfa, accessToken: session.body.accessToken as string };
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([grantEverything(db, tenantA), grantEverything(db, tenantB)]);
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('records the policy change with actor, subject, summary, address, user agent and request id', async () => {
    const admin = await verifiedAdmin(tenantA);
    await http().put('/settings/security').set(bearer(admin.accessToken)).set('x-request-id', 'audit-req-1').set('user-agent', 'audit-test/1.0').send({ mfaRequired: true }).expect(200);
    await http().put('/settings/security').set(bearer(admin.accessToken)).send({ mfaRequired: false }).expect(200);

    const page = (await logs(admin.accessToken, { action: 'tenant.security_policy_updated' }).expect(200)).body as { items: AuditItem[]; nextCursor: string | null };
    expect(page.items).toHaveLength(2);
    const first = page.items[1]!;
    expect(first).toMatchObject({
      actor: { id: admin.user.userId },
      action: 'tenant.security_policy_updated',
      subjectType: 'Setting',
      subjectId: tenantA.tenantId,
      before: { mfaRequired: false },
      after: { mfaRequired: true },
      userAgent: 'audit-test/1.0',
      requestId: 'audit-req-1',
    });
    expect(first.ipAddress).toBeTruthy();
    expect(Math.abs(Date.parse(first.at) - Date.now())).toBeLessThan(60_000);
    expect(page.items[0]).toMatchObject({ before: { mfaRequired: true }, after: { mfaRequired: false } });
  });

  it('records account events in the organization of the session, with no secret in them', async () => {
    const user = await seedUser(db, tenantA);
    const session = await signIn(app, user.email, tenantA.tenantId);
    await http().post('/auth/password').set(bearer(session.accessToken)).send({ currentPassword: user.password, newPassword: 'another passphrase!' }).expect(204);
    const admin = await verifiedAdmin(tenantA);
    const page = (await logs(admin.accessToken, { action: 'account.', actorId: user.userId }).expect(200)).body as { items: AuditItem[] };
    expect(page.items).toEqual([expect.objectContaining({ action: 'account.password_changed', subjectType: 'User', subjectId: user.userId })]);
    expect(JSON.stringify(page.items)).not.toMatch(/another passphrase|hash|secret/i);
  });

  it('an action that fails leaves no row (the row is written in the same transaction)', async () => {
    const admin = await verifiedAdmin(tenantA);
    const plain = await seedUser(db, tenantA);
    const plainSession = await signIn(app, plain.email, tenantA.tenantId);
    const before = (await logs(admin.accessToken, { action: 'tenant.', actorId: plain.userId }).expect(200)).body.items;
    await http().put('/settings/security').set(bearer(plainSession.accessToken)).send({ mfaRequired: true }).expect(422);
    const after = (await logs(admin.accessToken, { action: 'tenant.', actorId: plain.userId }).expect(200)).body.items;
    expect(after).toEqual(before);
  });

  describe('querying', () => {
    let admin: Awaited<ReturnType<typeof verifiedAdmin>>;

    beforeAll(async () => {
      admin = await verifiedAdmin(tenantA);
      for (let index = 0; index < 5; index += 1) {
        await db.owner.query(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type) VALUES ($1, $2, $3, 'Role')`, [tenantA.tenantId, admin.user.userId, index % 2 === 0 ? 'role.created' : 'role.deleted']);
      }
    });

    it('pages with a cursor, newest first, without repeating or skipping rows', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 50; guard += 1) {
        const body = (await logs(admin.accessToken, { limit: 3, ...(cursor === undefined ? {} : { cursor }) }).expect(200)).body as { items: AuditItem[]; nextCursor: string | null };
        expect(body.items.length).toBeLessThanOrEqual(3);
        seen.push(...body.items.map((item) => item.id));
        if (body.nextCursor === null) break;
        cursor = body.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort().reverse()).toEqual(seen);
      const total = await db.owner.query('SELECT 1 FROM audit_logs WHERE tenant_id = $1', [tenantA.tenantId]);
      expect(seen).toHaveLength(total.rowCount!);
    });

    it('filters by exact action, by prefix, by actor and by subject type', async () => {
      const exact = (await logs(admin.accessToken, { action: 'role.created' }).expect(200)).body.items as AuditItem[];
      expect(exact.length).toBeGreaterThanOrEqual(3);
      expect(exact.every((item) => item.action === 'role.created')).toBe(true);
      const prefix = (await logs(admin.accessToken, { action: 'role.' }).expect(200)).body.items as AuditItem[];
      expect(prefix.every((item) => item.action.startsWith('role.'))).toBe(true);
      expect(prefix.length).toBeGreaterThan(exact.length);
      const byActor = (await logs(admin.accessToken, { actorId: admin.user.userId }).expect(200)).body.items as AuditItem[];
      expect(byActor.every((item) => item.actor?.id === admin.user.userId)).toBe(true);
      const bySubject = (await logs(admin.accessToken, { subjectType: 'Role' }).expect(200)).body.items as AuditItem[];
      expect(bySubject.every((item) => item.subjectType === 'Role')).toBe(true);
    });

    it('limits the date range and rejects malformed filters', async () => {
      await logs(admin.accessToken, { from: '2020-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' }).expect(400);
      await logs(admin.accessToken, { from: '2026-12-31T00:00:00Z', to: '2026-01-01T00:00:00Z' }).expect(400);
      await logs(admin.accessToken, { limit: 101 }).expect(400);
      await logs(admin.accessToken, { actorId: 'not-a-uuid' }).expect(400);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect((await logs(admin.accessToken, { from: future, to: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(200)).body.items).toEqual([]);
    });

    it('needs the permission to read the audit log', async () => {
      const roleId = await seedRole(db, tenantA.tenantId, 'No audit');
      const limited = await seedUser(db, tenantA, undefined, { roleId });
      const session = await signIn(app, limited.email, tenantA.tenantId);
      await logs(session.accessToken).expect(403);
    });
  });

  it('tenant leak: one organization never sees the rows of another, whatever the filter', async () => {
    const [adminA, adminB] = [await verifiedAdmin(tenantA), await verifiedAdmin(tenantB)];
    await db.owner.query(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, 'role.deleted', 'Role', $3)`, [tenantB.tenantId, adminB.user.userId, adminB.user.userId]);

    const everythingA = (await logs(adminA.accessToken, { limit: 100 }).expect(200)).body.items as AuditItem[];
    expect(everythingA.some((item) => item.actor?.id === adminB.user.userId)).toBe(false);
    expect((await logs(adminA.accessToken, { actorId: adminB.user.userId }).expect(200)).body.items).toEqual([]);
    expect((await logs(adminA.accessToken, { subjectId: adminB.user.userId }).expect(200)).body.items).toEqual([]);
    const idsOfB = (await db.owner.query<{ id: string }>('SELECT id FROM audit_logs WHERE tenant_id = $1', [tenantB.tenantId])).rows.map((row) => row.id);
    expect(everythingA.some((item) => idsOfB.includes(item.id))).toBe(false);
    const asB = (await logs(adminB.accessToken, { actorId: adminB.user.userId }).expect(200)).body.items as AuditItem[];
    expect(asB.length).toBeGreaterThan(0);
  });
});
