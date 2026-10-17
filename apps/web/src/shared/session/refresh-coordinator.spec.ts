import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/shared/api';
import { createFakeAuthServer } from '@/test/fake-auth-server';
import { createFakeChannelHub } from '@/test/fake-session-channel';
import { createFakeTransport } from '@/test/fake-transport';
import { makeJwt } from '@/test/jwt';
import { type AccessToken, toAccessToken } from './access-token';
import { createInProcessLock, type ExclusiveLock } from './exclusive-lock';
import { createRefreshCoordinator } from './refresh-coordinator';
import type { SessionChannel } from './session-channel';
import { RefreshFailedError } from './session-errors';
import { createTokenStore } from './token-store';

const NOW = 1_000_000;
const now = () => NOW;
let requestIds = 0;

type Server = ReturnType<typeof createFakeAuthServer>;

function openTab(server: Server, lock: ExclusiveLock, channel: SessionChannel) {
  const store = createTokenStore();
  const fake = createFakeTransport({ '/auth/refresh': server.refresh, '/auth/logout': server.logout });
  const coordinator = createRefreshCoordinator({
    transport: fake.transport,
    store,
    lock,
    channel,
    now,
    createRequestId: () => `request-${++requestIds}`,
    peerTimeoutMs: 20,
  });
  return { store, coordinator, fake };
}

function setUp() {
  const server = createFakeAuthServer();
  const lock = createInProcessLock();
  const hub = createFakeChannelHub();
  const tab = () => openTab(server, lock, hub.channel());
  return { server, lock, hub, tab };
}

const tokenExpiringIn = (ms: number, sid = 'old'): AccessToken => toAccessToken({ accessToken: makeJwt({ sid }), tokenType: 'Bearer', expiresIn: ms / 1000 }, NOW);

describe('createRefreshCoordinator', () => {
  it('renews once for concurrent requests of the same tab', async () => {
    const { server, tab } = setUp();
    const { coordinator, store } = tab();

    const tokens = await Promise.all([coordinator.renew(), coordinator.renew(), coordinator.renew()]);

    expect(server.refresh).toHaveBeenCalledTimes(1);
    expect(new Set(tokens.map((token) => token.value)).size).toBe(1);
    expect(store.get()?.value).toBe(tokens[0]?.value);
  });

  it('returns the current token without asking the API while it is fresh', async () => {
    const { server, tab } = setUp();
    const { coordinator, store } = tab();
    store.set(tokenExpiringIn(600_000));

    await coordinator.renew();

    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('renews a token that is about to expire', async () => {
    const { server, tab } = setUp();
    const { coordinator, store } = tab();
    store.set(tokenExpiringIn(10_000));

    await coordinator.renew();

    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('renews once when two tabs reject the same token at the same time, and both end up with the new one', async () => {
    const { server, tab } = setUp();
    const first = tab();
    const second = tab();
    const old = tokenExpiringIn(600_000);
    first.store.set(old);
    second.store.set(old);

    const [a, b] = await Promise.all([first.coordinator.renew(old.value), second.coordinator.renew(old.value)]);

    expect(server.refresh).toHaveBeenCalledTimes(1);
    expect(b.value).toBe(a.value);
    expect(second.store.get()?.value).toBe(a.value);
  });

  it('hands back a token that already replaced the rejected one without asking the API', async () => {
    const { server, tab } = setUp();
    const { coordinator, store } = tab();
    const fresh = tokenExpiringIn(600_000, 'fresh');
    store.set(fresh);

    await expect(coordinator.renew('a-token-replaced-before')).resolves.toBe(fresh);
    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('takes the token of another tab when it starts, without rotating the session', async () => {
    const { server, tab } = setUp();
    const signedIn = tab();
    signedIn.store.set(tokenExpiringIn(600_000, 'shared'));
    const starting = tab();

    const token = await starting.coordinator.renew();

    expect(token.identity.sessionId).toBe('shared');
    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('does not share a token that is about to expire', async () => {
    const { server, tab } = setUp();
    const signedIn = tab();
    signedIn.store.set(tokenExpiringIn(45_000, 'dying'));
    const starting = tab();

    await starting.coordinator.renew();

    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('refreshes when no tab answers in time', async () => {
    const { server, tab } = setUp();
    const { coordinator } = tab();

    await coordinator.renew();

    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('announces the new token before releasing the lock', async () => {
    const server = createFakeAuthServer();
    const events: string[] = [];
    const inner = createInProcessLock();
    const lock: ExclusiveLock = { run: (work) => inner.run(work).finally(() => events.push('released')) };
    const hub = createFakeChannelHub();
    const channel = hub.channel();
    const spied: SessionChannel = { ...channel, post: (message) => (events.push(message.type), channel.post(message)) };
    const { coordinator } = openTab(server, lock, spied);

    await coordinator.renew();

    expect(events.filter((event) => event !== 'token-request')).toEqual(['token', 'released']);
  });

  it('ignores a broadcast token that cannot be read', async () => {
    const { hub, tab } = setUp();
    const { store } = tab();
    hub.channel().post({ type: 'token', token: 'garbage', receivedAt: NOW, expiresAt: NOW + 1 });
    await Promise.resolve();
    expect(store.get()).toBeUndefined();
  });

  it.each([
    ['unauthenticated', new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' })],
    ['mfaRequired', new ApiError({ status: 403, code: 'MFA_REQUIRED', message: 'x' })],
    ['blocked', new ApiError({ status: 403, code: 'TENANT_SUSPENDED', message: 'x' })],
    ['unavailable', new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' })],
  ])('reports a refresh refused as %s', async (kind, error) => {
    const { server, tab } = setUp();
    server.refresh.mockImplementation(() => {
      throw error;
    });
    const { coordinator } = tab();

    const failure = await coordinator.renew().catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(RefreshFailedError);
    expect((failure as RefreshFailedError).failure.kind).toBe(kind);
  });

  it('asks again once, inside the lock, when the answer was lost on the network', async () => {
    const { server, tab } = setUp();
    server.refresh.mockImplementationOnce(() => {
      throw new NetworkError(new TypeError('offline'));
    });
    const { coordinator } = tab();

    await expect(coordinator.renew()).resolves.toBeDefined();
    expect(server.refresh).toHaveBeenCalledTimes(2);
  });

  it('reports a network failure after the single retry', async () => {
    const { server, tab } = setUp();
    server.refresh.mockImplementation(() => {
      throw new NetworkError(new TypeError('offline'));
    });
    const { coordinator } = tab();

    await expect(coordinator.renew()).rejects.toMatchObject({ failure: { kind: 'network' } });
    expect(server.refresh).toHaveBeenCalledTimes(2);
  });

  it('opens a session only after a refresh in flight finished, and announces it', async () => {
    const { server, hub, tab } = setUp();
    const { coordinator, store } = tab();
    const order: string[] = [];
    server.refresh.mockImplementation(() => (order.push('refresh'), server.issue()));

    const renewing = coordinator.renew();
    const opening = coordinator.establish(async () => (order.push('select-tenant'), server.issue('tenant-2')));
    await Promise.all([renewing, opening]);

    expect(order).toEqual(['refresh', 'select-tenant']);
    expect(store.get()?.identity.tenantId).toBe('tenant-2');
    expect(hub.posted.at(-1)).toMatchObject({ type: 'token' });
  });

  it('revokes and forgets the session, even when the logout call fails', async () => {
    const { server, tab } = setUp();
    server.logout.mockImplementation(() => {
      throw new NetworkError(new TypeError('offline'));
    });
    const { coordinator, store } = tab();
    store.set(tokenExpiringIn(600_000));

    await coordinator.endSession(true);

    expect(server.logout).toHaveBeenCalledOnce();
    expect(store.get()).toBeUndefined();
  });

  it('forgets the session without calling the API when it is not asked to revoke', async () => {
    const { server, tab } = setUp();
    const { coordinator } = tab();
    await coordinator.endSession(false);
    expect(server.logout).not.toHaveBeenCalled();
  });

  it('stops listening to the other tabs once disposed', async () => {
    const { hub, tab } = setUp();
    const { coordinator, store } = tab();
    coordinator.dispose();
    const token = tokenExpiringIn(600_000, 'later');
    hub.channel().post({ type: 'token', token: token.value, receivedAt: token.receivedAt, expiresAt: token.expiresAt });
    await Promise.resolve();
    expect(store.get()).toBeUndefined();
  });
});
