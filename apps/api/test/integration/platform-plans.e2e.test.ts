import type { INestApplication } from '@nestjs/common';
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

describe('platform console: plans', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  let code: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
    // Edits go to a plan of their own: the seeded ones are shared by every other test.
    code = `edit-${Math.random().toString(36).slice(2, 8)}`;
    await db.owner.query(`INSERT INTO plans (code, name, storage_base_bytes, storage_per_user_bytes, max_users) VALUES ($1, 'Editable', 1000, 10, 5)`, [code]);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('lists the plans with their limits and how many tenants use each', async () => {
    const tenant = await seedTenant(db.platform);
    await db.owner.query(`UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = $2) WHERE id = $1`, [tenant.tenantId, code]);
    const { body } = await http().get('/platform/plans').set(bearer(token)).expect(200);
    expect(body).toContainEqual({ code, name: 'Editable', storageBaseBytes: '1000', storagePerUserBytes: '10', storageGracePercent: 5, maxUsers: 5, isActive: true, tenants: 1 });
    expect(body.map((plan: { code: string }) => plan.code)).toEqual(expect.arrayContaining(['trial', 'basic', 'professional', 'enterprise']));
  });

  it('edits only the fields sent, takes effect on the tenants quota at once, and audits before and after', async () => {
    const tenant = await seedTenant(db.platform);
    await db.owner.query(`UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = $2) WHERE id = $1`, [tenant.tenantId, code]);
    const { body } = await http().put(`/platform/plans/${code}`).set(bearer(token)).send({ storageBaseBytes: '5000', maxUsers: null }).expect(200);
    expect(body).toMatchObject({ code, name: 'Editable', storageBaseBytes: '5000', storagePerUserBytes: '10', maxUsers: null });

    const detail = await http().get(`/platform/tenants/${tenant.tenantId}`).set(bearer(token)).expect(200);
    expect(detail.body.storage.limitBytes).toBe('5010'); // 5000 + 10 per active user (1)
    const log = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE action = 'plan.updated' AND data ->> 'code' = $1`, [code]);
    expect(log.rows).toEqual([{ data: { code, from: { storageBaseBytes: '1000', maxUsers: 5 }, to: { storageBaseBytes: '5000', maxUsers: null } } }]);
  });

  it('refuses an empty body, negative or non-integer limits, and an unknown plan', async () => {
    await http().put(`/platform/plans/${code}`).set(bearer(token)).send({}).expect(400);
    await http().put(`/platform/plans/${code}`).set(bearer(token)).send({ storageBaseBytes: '-1' }).expect(400);
    await http().put(`/platform/plans/${code}`).set(bearer(token)).send({ storageGracePercent: 101 }).expect(400);
    await http().put(`/platform/plans/${code}`).set(bearer(token)).send({ maxUsers: 0 }).expect(400);
    await http().put('/platform/plans/nope').set(bearer(token)).send({ name: 'x' }).expect(404);
  });

  it('a tenant user gets 403 and no token gets 401', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await http().get('/platform/plans').set(bearer(accessToken)).expect(403);
    await http().put(`/platform/plans/${code}`).set(bearer(accessToken)).send({ name: 'x' }).expect(403);
    await http().get('/platform/plans').expect(401);
  });
});
