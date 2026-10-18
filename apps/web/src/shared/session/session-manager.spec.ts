import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/shared/api';
import { createFakeAuthServer } from '@/test/fake-auth-server';
import { fakeProfile } from '@/test/fake-profile';
import { createFakeChannelHub } from '@/test/fake-session-channel';
import { createFakeTransport, type FakeHandler } from '@/test/fake-transport';
import { createInProcessLock } from './exclusive-lock';
import { createRefreshCoordinator } from './refresh-coordinator';
import { createSessionManager, type SessionManager } from './session-manager';
import { createTokenStore } from './token-store';

const meOf = (authorization: string | undefined, tenantMode: 'ACTIVE' | 'DELETION_PENDING' = 'ACTIVE') => fakeProfile(authorization, { tenantMode });

const managers: SessionManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.dispose());
  vi.useRealTimers();
});

function setUp(extraHandlers: Record<string, FakeHandler> = {}) {
  const server = createFakeAuthServer();
  const hub = createFakeChannelHub();
  const lock = createInProcessLock();
  const me = vi.fn<FakeHandler>((options) => meOf(options.headers?.Authorization));
  let ids = 0;

  let wakeListeners: (() => void)[] = [];
  const wake = () => wakeListeners.forEach((listener) => listener());

  function openTab() {
    const store = createTokenStore();
    const channel = hub.channel();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fake = createFakeTransport({ '/auth/refresh': server.refresh, '/auth/logout': server.logout, '/auth/me': me, ...extraHandlers });
    const coordinator = createRefreshCoordinator({ transport: fake.transport, store, lock, channel, now: Date.now, createRequestId: () => `r${++ids}`, peerTimeoutMs: 10 });
    const manager = createSessionManager({
      transport: fake.transport,
      store,
      coordinator,
      channel,
      queryClient,
      now: Date.now,
      random: () => 0,
      onWake: (listener) => {
        wakeListeners.push(listener);
        return () => (wakeListeners = wakeListeners.filter((other) => other !== listener));
      },
    });
    managers.push(manager);
    return { manager, store, queryClient, fake };
  }

  return { server, hub, me, openTab, wake };
}

const statusOf = (manager: SessionManager) => manager.getState().status;
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true));

describe('createSessionManager', () => {
  it('recovers the session from the cookie and loads the profile', async () => {
    const { openTab, server } = setUp();
    const { manager, queryClient } = openTab();

    manager.start();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    expect(server.refresh).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['session', 'me'])).toMatchObject({ user: { firstName: 'Ana' } });
  });

  it('is signed out without a notice when there is no session cookie', async () => {
    const { openTab, server } = setUp();
    server.refresh.mockImplementation(() => {
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
    });
    const { manager } = openTab();

    manager.start();
    await until(() => statusOf(manager) === 'signedOut');

    expect(manager.getState()).toEqual({ status: 'signedOut', reason: undefined });
  });

  it('shows the server as unavailable when the profile cannot be loaded, and recovers on retry', async () => {
    const { openTab, me } = setUp();
    me.mockImplementationOnce(() => {
      throw new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' });
    });
    const { manager } = openTab();

    manager.start();
    await until(() => statusOf(manager) === 'unavailable');
    manager.retry();
    await until(() => statusOf(manager) === 'signedIn');
  });

  it('blocks the session, forgets the token and drops the data when the organization is suspended', async () => {
    const { openTab } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'TENANT_SUSPENDED', message: 'x' });
      },
    });
    const { manager, store, queryClient } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    await expect(manager.client.request('/tickets')).rejects.toBeInstanceOf(ApiError);

    expect(manager.getState()).toEqual({ status: 'blocked', block: { kind: 'tenantSuspended' } });
    expect(store.get()).toBeUndefined();
    expect(queryClient.getQueryData(['session', 'me'])).toBeUndefined();
  });

  it('retries by itself when the maintenance window should be over', async () => {
    const { openTab, server } = setUp();
    server.refresh.mockImplementationOnce(() => {
      throw new ApiError({ status: 503, code: 'MAINTENANCE', message: 'x', details: { title: 'Mantenimiento', endsAt: null }, retryAfterSeconds: 1 });
    });
    const { manager } = openTab();

    manager.start();
    await until(() => statusOf(manager) === 'blocked');
    await vi.waitFor(() => expect(statusOf(manager)).toBe('signedIn'), { timeout: 3_000 });
  });

  it('stays in a pending-deletion organization when the profile says the session may export', async () => {
    const { openTab, me } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'TENANT_PENDING_DELETION', message: 'x' });
      },
    });
    me.mockImplementation((options) => meOf(options.headers?.Authorization, 'DELETION_PENDING'));
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    await manager.client.request('/tickets').catch(() => undefined);
    await vi.waitFor(() => expect(me).toHaveBeenCalledTimes(2));

    expect(statusOf(manager)).toBe('signedIn');
  });

  it('blocks a pending-deletion organization the profile does not allow', async () => {
    const { openTab, me } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'TENANT_PENDING_DELETION', message: 'x' });
      },
    });
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    await manager.client.request('/tickets').catch(() => undefined);

    await until(() => statusOf(manager) === 'blocked');
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('signs out: revokes on the server, drops the data and tells the other tabs', async () => {
    const { openTab, server, hub } = setUp();
    const first = openTab();
    const second = openTab();
    first.manager.start();
    await until(() => statusOf(first.manager) === 'signedIn');
    second.manager.start();
    await until(() => statusOf(second.manager) === 'signedIn');

    await first.manager.signOut();

    expect(server.logout).toHaveBeenCalledOnce();
    expect(first.manager.getState()).toEqual({ status: 'signedOut', reason: 'userSignedOut' });
    expect(first.queryClient.getQueryData(['session', 'me'])).toBeUndefined();
    expect(hub.posted).toContainEqual({ type: 'signed-out', reason: 'userSignedOut' });
    await until(() => statusOf(second.manager) === 'signedOut');
    expect(second.manager.getState()).toEqual({ status: 'signedOut', reason: 'signedOutElsewhere' });
    expect(second.store.get()).toBeUndefined();
  });

  it('shares one refresh between two tabs that start together', async () => {
    const { openTab, server } = setUp();
    const first = openTab();
    const second = openTab();

    first.manager.start();
    second.manager.start();
    await until(() => statusOf(first.manager) === 'signedIn' && statusOf(second.manager) === 'signedIn');

    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('drops the data of the previous organization when another tab opens a session in a different one', async () => {
    const { openTab, server } = setUp();
    const first = openTab();
    const second = openTab();
    first.manager.start();
    await until(() => statusOf(first.manager) === 'signedIn');
    second.manager.start();
    await until(() => statusOf(second.manager) === 'signedIn');
    second.queryClient.setQueryData(['tickets'], ['ticket of tenant-1']);

    await first.manager.establish(async () => server.issue('tenant-2'));

    await until(() => statusOf(second.manager) === 'signedIn' && second.store.get()?.identity.tenantId === 'tenant-2');
    expect(second.queryClient.getQueryData(['tickets'])).toBeUndefined();
    expect(second.queryClient.getQueryData(['session', 'me'])).toMatchObject({ membership: { role: { name: 'Rol tenant-2' } } });
  });

  it('signs out with its notice and revokes the session when the organization starts requiring MFA', async () => {
    const { openTab, server } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'MFA_REQUIRED', message: 'x' });
      },
    });
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    await manager.client.request('/tickets').catch(() => undefined);

    await until(() => statusOf(manager) === 'signedOut');
    expect(manager.getState()).toEqual({ status: 'signedOut', reason: 'mfaRequired' });
    expect(server.logout).toHaveBeenCalledOnce();
  });

  it('signs out with the expired notice when the session can no longer be renewed', async () => {
    const { openTab, server, hub } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
      },
    });
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');
    server.refresh.mockImplementation(() => {
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
    });

    await manager.client.request('/tickets').catch(() => undefined);

    expect(manager.getState()).toEqual({ status: 'signedOut', reason: 'expired' });
    expect(hub.posted).toContainEqual({ type: 'signed-out', reason: 'expired' });
  });

  it('starts again by itself when the network comes back after a failed start', async () => {
    const { openTab, server, wake } = setUp();
    server.refresh.mockImplementation(() => {
      throw new NetworkError(new TypeError('offline'));
    });
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'unavailable');

    server.refresh.mockImplementation(() => server.issue());
    wake();

    await until(() => statusOf(manager) === 'signedIn');
  });

  it('cancels the maintenance retry when the person signs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { openTab, server } = setUp();
    server.refresh.mockImplementationOnce(() => {
      throw new ApiError({ status: 503, code: 'MAINTENANCE', message: 'x', details: { title: 'x', endsAt: null }, retryAfterSeconds: 60 });
    });
    const { manager } = openTab();
    manager.start();
    await vi.waitFor(() => expect(statusOf(manager)).toBe('blocked'));

    await manager.signOut();
    const refreshesAfterSignOut = server.refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(61_000);

    expect(server.refresh).toHaveBeenCalledTimes(refreshesAfterSignOut);
    expect(manager.getState()).toEqual({ status: 'signedOut', reason: 'userSignedOut' });
  });

  it('ends the session once when several answers ask for it at the same time', async () => {
    const { openTab, server } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'MFA_REQUIRED', message: 'x' });
      },
    });
    const { manager } = openTab();
    manager.start();
    await until(() => statusOf(manager) === 'signedIn');

    await Promise.all([manager.client.request('/tickets'), manager.client.request('/tickets'), manager.client.request('/tickets')].map((request) => request.catch(() => undefined)));
    await until(() => statusOf(manager) === 'signedOut');

    expect(server.logout).toHaveBeenCalledOnce();
  });

  it('tells the other tabs why: an organization that now requires MFA keeps its notice there too', async () => {
    const { openTab, server } = setUp({
      '/tickets': () => {
        throw new ApiError({ status: 403, code: 'MFA_REQUIRED', message: 'x' });
      },
    });
    const first = openTab();
    const second = openTab();
    first.manager.start();
    await until(() => statusOf(first.manager) === 'signedIn');
    second.manager.start();
    await until(() => statusOf(second.manager) === 'signedIn');

    await first.manager.client.request('/tickets').catch(() => undefined);

    await until(() => statusOf(second.manager) === 'signedOut');
    expect(second.manager.getState()).toEqual({ status: 'signedOut', reason: 'mfaRequired' });
    expect(server.logout).toHaveBeenCalledOnce();
  });
});
