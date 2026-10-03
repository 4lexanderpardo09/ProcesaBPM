import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import type { RateLimiter, RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';
import type { AccessTokenAuthenticator } from '../../auth/application/access-token-authenticator.js';
import { DbWorkLimiter } from '../application/db-work-limiter.js';
import type { RealtimeSocket } from '../application/socket-session.js';
import { HANDSHAKES_PER_ADDRESS, HANDSHAKES_PER_USER, SocketHandshake } from './socket-handshake.js';

const principal: Principal = { userId: 'u1', tenantId: 't1', sessionId: 's1', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } };

function setUp(allowed: (key: string) => boolean = () => true) {
  const hits: Array<[string, RateLimitRule]> = [];
  const rateLimiter: RateLimiter = { hit: (key, rule) => (hits.push([key, rule]), Promise.resolve({ allowed: allowed(key), retryAfterSeconds: 30 })) };
  const authenticator = { authenticate: vi.fn(() => Promise.resolve({ principal, expiresAt: new Date(Date.now() + 60_000) })) } as unknown as AccessTokenAuthenticator;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as JsonLogger;
  const handshake = new SocketHandshake(authenticator, new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 }), rateLimiter, logger);
  const run = (handshakeData: { auth?: unknown; query?: Record<string, string>; headers?: Record<string, string> }) => {
    const socket = { data: {}, request: { socket: { remoteAddress: '198.51.100.1' } }, handshake: { auth: handshakeData.auth ?? {}, query: handshakeData.query ?? {}, headers: handshakeData.headers ?? {} } } as unknown as RealtimeSocket;
    return new Promise<{ socket: RealtimeSocket; error: (Error & { data?: unknown }) | undefined }>((resolve) => handshake.middleware(socket, (error) => resolve({ socket, error })));
  };
  return { run, hits, authenticator };
}

describe('SocketHandshake', () => {
  it('limits per address generously (offices behind one NAT) and per person tightly', async () => {
    expect(HANDSHAKES_PER_ADDRESS).toEqual({ limit: 600, windowMs: 60_000 });
    expect(HANDSHAKES_PER_USER).toEqual({ limit: 30, windowMs: 60_000 });
    const { run, hits } = setUp();
    const { socket, error } = await run({ auth: { token: 'a.b.c' } });
    expect(error).toBeUndefined();
    expect(socket.data.session?.principal).toBe(principal);
    expect(hits).toEqual([
      ['realtime.handshake:ip:198.51.100.1', HANDSHAKES_PER_ADDRESS],
      ['realtime.handshake:user:u1', HANDSHAKES_PER_USER],
    ]);
  });

  it('refuses a token outside the auth payload before looking at it', async () => {
    const { run, authenticator } = setUp();
    expect((await run({ auth: { token: 'a.b.c' }, query: { access_token: 'a.b.c' } })).error?.data).toEqual({ code: 'UNAUTHENTICATED' });
    expect((await run({ auth: { token: 'a.b.c' }, headers: { authorization: 'Bearer a.b.c' } })).error?.data).toEqual({ code: 'UNAUTHENTICATED' });
    expect(authenticator.authenticate).not.toHaveBeenCalled();
  });

  it('a rate-limited person is refused with the time to wait', async () => {
    const { run } = setUp((key) => !key.includes(':user:'));
    expect((await run({ auth: { token: 'a.b.c' } })).error?.data).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: 30 });
  });
});
