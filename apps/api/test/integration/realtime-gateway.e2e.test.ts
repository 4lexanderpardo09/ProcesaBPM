import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import type { AuthRefreshAck } from '@procesabpm/shared';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { ConnectionRegistry } from '../../src/modules/realtime/application/connection-registry.js';
import { SocketRevalidator } from '../../src/modules/realtime/application/socket-revalidator.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { seedUser } from '../support/auth-fixtures.js';
import { refreshCookieOf, type SignedIn, signIn } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedRole } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { connected, connectError, connectSocket, emitWithAck, nextEvent, notifySignal, recordEvents, startListening } from '../support/realtime-client.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';

const MAX_PER_USER = 3;
// Debug logs on, so that the log check below sees every line real time writes.
useTestEnvironment({ REALTIME_MAX_CONNECTIONS_PER_USER: String(MAX_PER_USER), LOG_LEVEL: 'debug' });

const sessionIdOf = (accessToken: string): string => (JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8')) as { sid: string }).sid;

describe('realtime gateway: handshake, session revalidation and limits', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let logLines: string[];
  let url: string;
  let clock: TestClock;
  let tenant: SeededTenant;
  const sockets: Socket[] = [];

  const open = (token: string | undefined, options?: Parameters<typeof connectSocket>[2]) => {
    const socket = connectSocket(url, token, options);
    sockets.push(socket);
    return socket;
  };
  const member = async (): Promise<SignedIn & { userId: string }> => {
    const user = await seedUser(db, tenant);
    return { userId: user.userId, ...(await signIn(app, user.email, tenant.tenantId)) };
  };
  const http = () => request(app.getHttpServer());
  const revalidator = () => app.get(SocketRevalidator);

  beforeAll(async () => {
    db = connectTestDatabase();
    clock = new TestClock(new Date());
    ({ app, logLines } = await createTestApp({ clock }));
    url = await startListening(app);
    tenant = await seedTenant(db.platform);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('handshake', () => {
    it('accepts a valid access token sent in the auth payload', async () => {
      const { accessToken } = await member();
      const socket = open(accessToken);
      await connected(socket);
      expect(socket.connected).toBe(true);
    });

    it.each([
      ['no token', undefined],
      ['garbage', 'not-a-token'],
      ['a token signed with another key', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl'],
    ])('refuses %s with UNAUTHENTICATED', async (_name, token) => {
      expect(await connectError(open(token))).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses a platform token (another audience)', async () => {
      const platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
      expect(await connectError(open(platformToken))).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses a token in the URL or in a header even when the auth payload is valid', async () => {
      const { accessToken } = await member();
      expect(await connectError(open(accessToken, { query: { token: accessToken } }))).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(await connectError(open(accessToken, { headers: { authorization: `Bearer ${accessToken}` } }))).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses another origin, or none, before the upgrade (no socket, no code)', async () => {
      const { accessToken } = await member();
      for (const origin of ['http://evil.test', null]) {
        const refused = await connectError(open(accessToken, { origin }));
        expect(refused.code).toBeUndefined();
      }
      const upgrade = await http().get('/realtime/?EIO=4&transport=websocket').set('origin', 'http://evil.test').set('connection', 'Upgrade').set('upgrade', 'websocket');
      expect(upgrade.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses the members of a suspended tenant with TENANT_SUSPENDED', async () => {
      const other = await seedTenant(db.platform);
      const user = await seedUser(db, other);
      const { accessToken } = await signIn(app, user.email, other.tenantId);
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [other.tenantId]);
      expect(await connectError(open(accessToken))).toMatchObject({ code: 'TENANT_SUSPENDED' });
    });
  });

  describe('limits', () => {
    it(`a person keeps at most ${MAX_PER_USER} sockets per instance: the oldest is ended as REPLACED`, async () => {
      const { accessToken } = await member();
      const first = open(accessToken);
      await connected(first);
      const ended = nextEvent<{ reason: string }>(first, 'session.ended');
      for (let index = 1; index < MAX_PER_USER; index += 1) await connected(open(accessToken));
      const newest = open(accessToken);
      await connected(newest);
      expect(await ended).toEqual({ reason: 'REPLACED' });
      expect(newest.connected).toBe(true);
    });

    it('unknown events beyond the allowance end the socket as RATE_LIMITED', async () => {
      const { accessToken } = await member();
      const socket = open(accessToken);
      await connected(socket);
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      for (let index = 0; index < 25; index += 1) socket.emit('nonsense', {});
      expect(await ended).toEqual({ reason: 'RATE_LIMITED' });
    });

    it('a malformed auth.refresh is answered VALIDATION_FAILED and the socket stays', async () => {
      const { accessToken } = await member();
      const socket = open(accessToken);
      await connected(socket);
      expect(await emitWithAck<AuthRefreshAck>(socket, 'auth.refresh', { token: accessToken, extra: true })).toEqual({ ok: false, code: 'VALIDATION_FAILED' });
      expect(socket.connected).toBe(true);
    });

    it('leaves nothing behind once the sockets are gone', async () => {
      const { accessToken } = await member();
      const batch = [open(accessToken), open(accessToken)];
      await Promise.all(batch.map(connected));
      for (const socket of batch) socket.disconnect();
      await expect.poll(() => app.get(ConnectionRegistry).stats().sockets).toBe(0);
      expect(app.get(ConnectionRegistry).stats()).toEqual({ sockets: 0, sessions: 0, rooms: 0, timers: 0 });
    });
  });

  describe('revocation', () => {
    it('a logout ends the socket at once: the database trigger signals it (SESSION_ENDED after the grace)', async () => {
      const signedIn = await member();
      const socket = open(signedIn.accessToken);
      await connected(socket);
      const required = nextEvent<{ reason: string; graceMs: number }>(socket, 'auth.required');
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      await http().post('/auth/logout').set('cookie', signedIn.refreshCookie).expect(204);
      expect(await required).toEqual({ reason: 'SESSION_CHANGED', graceMs: 1000 });
      expect(await ended).toEqual({ reason: 'SESSION_ENDED' });
    });

    it('without any signal, the sweep catches a revoked session', async () => {
      const signedIn = await member();
      const socket = open(signedIn.accessToken);
      await connected(socket);
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      await db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [sessionIdOf(signedIn.accessToken)]);
      await revalidator().sweepNow();
      expect(await ended).toEqual({ reason: 'SESSION_ENDED' });
    });

    it('a forged access signal about a valid session only causes a check: the socket stays', async () => {
      const valid = await member();
      const control = await member();
      const socket = open(valid.accessToken);
      const controlSocket = open(control.accessToken);
      await Promise.all([connected(socket), connected(controlSocket)]);
      const received = recordEvents(socket);
      const controlRequired = nextEvent<{ reason: string }>(controlSocket, 'auth.required');
      await http().post('/auth/logout').set('cookie', control.refreshCookie).expect(204);
      await notifySignal(inject('runtimeUrl'), { v: 1, k: 'access', s: sessionIdOf(valid.accessToken) });
      await notifySignal(inject('runtimeUrl'), { v: 1, k: 'access', t: tenant.tenantId });
      await notifySignal(inject('runtimeUrl'), { v: 1, k: 'access', s: sessionIdOf(control.accessToken) });
      expect(await controlRequired).toEqual({ reason: 'SESSION_CHANGED', graceMs: 1000 });
      await revalidator().whenIdle();
      expect(received).toEqual([]);
      expect(socket.connected).toBe(true);
    });

    it('a changed role ends the socket with PERMISSIONS_CHANGED, signalled by the trigger', async () => {
      const signedIn = await member();
      const socket = open(signedIn.accessToken);
      await connected(socket);
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      const roleId = await seedRole(db, tenant.tenantId, `Other ${Math.random()}`);
      await db.platform.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [roleId, tenant.tenantId, signedIn.userId]);
      expect(await ended).toEqual({ reason: 'PERMISSIONS_CHANGED' });
    });
  });

  describe('token expiry and auth.refresh (the test clock moves; these run last)', () => {
    it('another person\'s token is refused and ends the socket', async () => {
      const mine = await member();
      const theirs = await member();
      const socket = open(mine.accessToken);
      await connected(socket);
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      expect(await emitWithAck<AuthRefreshAck>(socket, 'auth.refresh', { token: theirs.accessToken })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
      expect(await ended).toEqual({ reason: 'SESSION_ENDED' });
    });

    it('an expired token asks for a new one; a refreshed token keeps the socket, a missing one ends it', async () => {
      const keeper = await member();
      const sleeper = await member();
      const kept = open(keeper.accessToken);
      const dropped = open(sleeper.accessToken);
      await Promise.all([connected(kept), connected(dropped)]);
      const keptRequired = nextEvent<{ reason: string; graceMs: number }>(kept, 'auth.required');
      const droppedEnded = nextEvent<{ reason: string }>(dropped, 'session.ended');

      clock.advanceMinutes(16);
      await revalidator().sweepNow();
      expect(await keptRequired).toEqual({ reason: 'TOKEN_EXPIRED', graceMs: 1000 });

      const refreshed = await http().post('/auth/refresh').set('cookie', keeper.refreshCookie).expect(200);
      expect(refreshCookieOf(refreshed)).toBeDefined();
      const newToken = refreshed.body.accessToken as string;
      expect(sessionIdOf(newToken)).not.toBe(sessionIdOf(keeper.accessToken));
      const ack = await emitWithAck<AuthRefreshAck>(kept, 'auth.refresh', { token: newToken });
      expect(ack).toEqual({ ok: true, expiresAt: expect.any(String) });

      expect(await droppedEnded).toEqual({ reason: 'TOKEN_EXPIRED' });
      await revalidator().sweepNow();
      expect(kept.connected).toBe(true);
      expect(app.get(ConnectionRegistry).socketsIn(`s:${sessionIdOf(newToken)}`)).toHaveLength(1);
    });

    it('never writes a token to the logs', () => {
      expect(logLines.some((line) => line.includes('realtime.rejected'))).toBe(true);
      expect(logLines.filter((line) => line.includes('eyJ'))).toEqual([]);
    });
  });
});

describe('realtime gateway: shutdown', () => {
  it('ends every socket with SERVER_SHUTDOWN when the application closes', async () => {
    const db = connectTestDatabase();
    const { app } = await createTestApp();
    try {
      const url = await startListening(app);
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const { accessToken } = await signIn(app, user.email, tenant.tenantId);
      const socket = connectSocket(url, accessToken);
      await connected(socket);
      const ended = nextEvent<{ reason: string }>(socket, 'session.ended');
      await app.close();
      expect(await ended).toEqual({ reason: 'SERVER_SHUTDOWN' });
      socket.disconnect();
    } finally {
      await db.close();
    }
  });
});
