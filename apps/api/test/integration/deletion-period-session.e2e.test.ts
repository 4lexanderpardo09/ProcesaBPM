import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { seedUser } from '../support/auth-fixtures.js';
import { bearer, logIn, refreshCookieOf, signIn } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedRole } from '../support/permission-fixtures.js';
import { deletedOrganization } from '../support/deletion-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { connectError, connectSocket, startListening } from '../support/realtime-client.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('signing in to an organization pending deletion', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let url: string;
  let platformToken: string;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());

  const deleted = () => deletedOrganization(app, db, platformToken);

  const select = async (email: string, tenantId: string) =>
    http().post('/auth/select-tenant').set(bearer(await logIn(app, email))).send({ tenantId });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    url = await startListening(app);
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('lets the owner and an administrator in, kept to their profile (and the export): every other route answers 403', async () => {
    const { tenant, owner, admin } = await deleted();
    for (const user of [owner, admin]) {
      const { accessToken } = await signIn(app, user.email, tenant.tenantId);
      const me = await http().get('/auth/me').set(bearer(accessToken)).expect(200);
      expect(me.body).toMatchObject({ tenantMode: 'DELETION_PENDING', user: { id: user.userId } });
      for (const path of ['/companies', '/tickets', '/settings/support-access', '/audit-logs', '/notifications']) {
        const refused = await http().get(path).set(bearer(accessToken));
        expect({ path, status: refused.status, code: refused.body?.error?.code }).toEqual({ path, status: 403, code: 'TENANT_PENDING_DELETION' });
      }
      const write = await http().post('/auth/password').set(bearer(accessToken)).send({ currentPassword: user.password, newPassword: 'another long password 123' });
      expect({ status: write.status, code: write.body?.error?.code }).toEqual({ status: 403, code: 'TENANT_PENDING_DELETION' });
    }
  });

  it('refuses a member without full access at the selection, as before', async () => {
    const { tenant, agent } = await deleted();
    const selected = await select(agent.email, tenant.tenantId);
    expect({ status: selected.status, code: selected.body?.error?.code }).toEqual({ status: 403, code: 'TENANT_PENDING_DELETION' });
  });

  it('refreshes the session of the owner, and stops doing so once the owner loses full access', async () => {
    const { tenant, admin } = await deleted();
    const selected = await select(admin.email, tenant.tenantId);
    expect(selected.status).toBe(200);
    const cookie = refreshCookieOf(selected)!;
    const refreshed = await http().post('/auth/refresh').set('cookie', cookie).expect(200);
    await http().get('/auth/me').set(bearer(refreshed.body.accessToken)).expect(200);

    const agentRole = await seedRole(db, tenant.tenantId, 'Demoted');
    await db.owner.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [agentRole, tenant.tenantId, admin.userId]);
    const denied = await http().get('/auth/me').set(bearer(refreshed.body.accessToken));
    expect({ status: denied.status, code: denied.body?.error?.code }).toEqual({ status: 403, code: 'TENANT_PENDING_DELETION' });
    const again = await http().post('/auth/refresh').set('cookie', refreshCookieOf(refreshed)!);
    expect({ status: again.status, code: again.body?.error?.code }).toEqual({ status: 403, code: 'TENANT_PENDING_DELETION' });
  });

  it('gives no real-time connection: there is nothing to watch', async () => {
    const { tenant, owner } = await deleted();
    const { accessToken } = await signIn(app, owner.email, tenant.tenantId);
    const socket = connectSocket(url, accessToken);
    sockets.push(socket);
    expect((await connectError(socket)).code).toBe('TENANT_SUSPENDED');
  });

  it('a platform session cannot use the tenant routes, and a suspended organization stays closed to its owner', async () => {
    await http().get('/auth/me').set(bearer(platformToken)).expect(401);
    const tenant = await seedTenant(db.platform);
    const owner = await seedUser(db, tenant);
    await db.owner.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, owner.userId]);
    await http().post(`/platform/tenants/${tenant.tenantId}/suspend`).set(bearer(platformToken)).send({ reason: 'Unpaid invoice' }).expect(200);
    const selected = await select(owner.email, tenant.tenantId);
    expect({ status: selected.status, code: selected.body?.error?.code }).toEqual({ status: 403, code: 'TENANT_SUSPENDED' });
  });
});
