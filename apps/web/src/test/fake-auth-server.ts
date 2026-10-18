import { vi } from 'vitest';
import { makeJwt } from './jwt';

export interface FakeAuthServerOptions {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly expiresIn?: number;
}

/** The auth endpoints the session talks to, shared by every fake tab: each refresh rotates the session id. */
export function createFakeAuthServer({ userId = 'user-1', tenantId = 'tenant-1', expiresIn = 900 }: FakeAuthServerOptions = {}) {
  let sessions = 0;
  const issue = (tid = tenantId) => ({ accessToken: makeJwt({ sub: userId, tid, sid: `session-${++sessions}` }), tokenType: 'Bearer' as const, expiresIn });
  return {
    issue,
    refresh: vi.fn<() => unknown>(() => issue()),
    logout: vi.fn<() => unknown>(() => undefined),
  };
}
