import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api';
import { createInProcessLock } from '@/shared/session/exclusive-lock';
import { createRefreshCoordinator } from '@/shared/session/refresh-coordinator';
import { createSessionManager } from '@/shared/session/session-manager';
import { createTokenStore } from '@/shared/session/token-store';
import { createFakeAuthServer } from './fake-auth-server';
import { fakeProfile } from './fake-profile';
import { createFakeChannelHub } from './fake-session-channel';
import { createFakeTransport, type FakeHandler } from './fake-transport';

export interface TestSessionOptions {
  /** Whether the refresh cookie opens a session at start. */
  readonly signedIn?: boolean;
  readonly handlers?: Record<string, FakeHandler>;
}

/** A real session manager over a fake API, for component and route tests. */
export function createTestSession({ signedIn = true, handlers = {} }: TestSessionOptions = {}) {
  const server = createFakeAuthServer();
  if (!signedIn) {
    server.refresh.mockImplementation(() => {
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'No session' });
    });
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const store = createTokenStore();
  const hub = createFakeChannelHub();
  const channel = hub.channel();
  /** The live routing table: a test may add or replace a handler after rendering. */
  const routes: Record<string, FakeHandler> = {
    '/auth/refresh': server.refresh,
    '/auth/logout': server.logout,
    '/auth/me': (options) => fakeProfile(options.headers?.Authorization),
    // An administrator by default: a test about permissions replaces it.
    '/auth/me/permissions': () => ({ permissions: [{ action: 'manage', subject: 'all', conditional: false }] }),
    '/auth/select-tenant': (options) => server.issue((options.body as { tenantId: string }).tenantId),
    '/auth/switch-tenant': (options) => server.issue((options.body as { tenantId: string }).tenantId),
    // The organization switcher: only the session's one unless a test says otherwise.
    '/auth/me/organizations': () => ({ organizations: [] }),
    '/tickets': () => ({ items: [], page: 1, pageSize: 25, total: 0 }),
    '/tickets/counts': () => ({ assigned: 0, created: 0, observed: 0, all: 0 }),
    // The home: nothing pending unless a test says otherwise.
    '/dashboard/stats': () => ({ myOpen: 0, myOverdue: 0, myDueSoon: 0, createdByMeOpen: 0, closedByMeWeek: 0 }),
    '/dashboard/pending': () => [],
    // The comment form offers the person's templates: none unless a test says otherwise.
    '/text-templates': () => [],
    // The bell in the top bar: nothing unread unless a test says otherwise.
    '/notifications/unread-count': () => ({ count: 0 }),
    // The platform's notices above every page: none unless a test says otherwise.
    '/announcements': () => [],
    ...handlers,
  };
  const fake = createFakeTransport(routes);
  let ids = 0;
  const coordinator = createRefreshCoordinator({ transport: fake.transport, store, lock: createInProcessLock(), channel, now: Date.now, createRequestId: () => `r${++ids}`, peerTimeoutMs: 5 });
  const session = createSessionManager({ transport: fake.transport, store, coordinator, channel, queryClient, now: Date.now, random: () => 0, onWake: () => () => undefined });
  return { session, queryClient, server, fake, store, hub, routes };
}
