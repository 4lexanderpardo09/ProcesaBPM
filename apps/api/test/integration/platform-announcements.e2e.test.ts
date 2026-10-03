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

const HOUR = 3_600_000;
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

describe('platform announcements', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  let memberToken: string;
  const http = () => request(app.getHttpServer());
  const create = (body: object) => http().post('/platform/announcements').set(bearer(token)).send(body);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    memberToken = (await signIn(app, user.email, tenant.tenantId)).accessToken;
    await db.owner.query('DELETE FROM platform_announcements');
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('creates, lists, updates and deletes, auditing each change', async () => {
    const created = await create({ type: 'MAINTENANCE', title: 'Window', body: 'Down for 1 hour', startsAt: at(1), endsAt: at(2), blocksLogin: true }).expect(201);
    expect(created.body).toMatchObject({ type: 'MAINTENANCE', title: 'Window', blocksLogin: true });
    const id = created.body.id as string;

    const listed = await http().get('/platform/announcements').set(bearer(token)).expect(200);
    expect(listed.body.map((a: { id: string }) => a.id)).toContain(id);

    const updated = await http().put(`/platform/announcements/${id}`).set(bearer(token)).send({ type: 'INFO', title: 'Changed', body: 'x', startsAt: at(1) }).expect(200);
    expect(updated.body).toMatchObject({ id, type: 'INFO', title: 'Changed', endsAt: null, blocksLogin: false });

    await http().delete(`/platform/announcements/${id}`).set(bearer(token)).expect(204);
    await http().delete(`/platform/announcements/${id}`).set(bearer(token)).expect(404);
    await http().put(`/platform/announcements/${id}`).set(bearer(token)).send({ type: 'INFO', title: 'x', body: 'x', startsAt: at(1) }).expect(404);

    const actions = await db.owner.query(`SELECT action FROM platform_audit_logs WHERE data ->> 'id' = $1 ORDER BY created_at`, [id]);
    expect(actions.rows.map((row) => row.action)).toEqual(['announcement.created', 'announcement.updated', 'announcement.deleted']);
  });

  it('refuses an end before the start, an unknown type and an empty title', async () => {
    await create({ type: 'INFO', title: 'x', body: 'x', startsAt: at(2), endsAt: at(1) }).expect(400);
    await create({ type: 'NEWS', title: 'x', body: 'x', startsAt: at(1) }).expect(400);
    await create({ type: 'INFO', title: ' ', body: 'x', startsAt: at(1) }).expect(400);
  });

  it('members see only the announcements in force now', async () => {
    await db.owner.query('DELETE FROM platform_announcements');
    await create({ type: 'INFO', title: 'In force', body: 'x', startsAt: at(-1) }).expect(201);
    await create({ type: 'INFO', title: 'Open ended', body: 'x', startsAt: at(-2), endsAt: null }).expect(201);
    await create({ type: 'INFO', title: 'Future', body: 'x', startsAt: at(1) }).expect(201);
    await create({ type: 'INFO', title: 'Over', body: 'x', startsAt: at(-3), endsAt: at(-2) }).expect(201);

    const { body } = await http().get('/announcements').set(bearer(memberToken)).expect(200);
    expect(body.map((a: { title: string }) => a.title)).toEqual(['In force', 'Open ended']);
    await http().get('/announcements').expect(401);
  });

  it('members cannot manage announcements', async () => {
    await http().get('/platform/announcements').set(bearer(memberToken)).expect(403);
    await http().post('/platform/announcements').set(bearer(memberToken)).send({ type: 'INFO', title: 'x', body: 'x', startsAt: at(1) }).expect(403);
    await http().delete('/platform/announcements/018f3c1e-7b2a-7c3d-9e4f-0123456789ab').set(bearer(memberToken)).expect(403);
  });
});
