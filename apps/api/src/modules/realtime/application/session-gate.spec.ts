import { MfaRequiredError, TemporarilyUnavailableError, UnauthenticatedError } from '@procesabpm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import type { AccessTokenAuthenticator } from '../../auth/application/access-token-authenticator.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { RealtimeEmitter } from './realtime-emitter.js';
import type { SessionExpiry } from './session-expiry.js';
import { SessionGate } from './session-gate.js';
import { monotonicNow, type RealtimeSocket, SocketSession } from './socket-session.js';

const principal: Principal = {
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: false,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null }, tenantMode: 'ACTIVE',
};

const socketWith = (session = new SocketSession(principal, new Date(Date.now() + 60_000), monotonicNow(), '127.0.0.1')) =>
  ({ id: Math.random().toString(36), data: { session } }) as unknown as RealtimeSocket;

/** A socket whose last verification is old: the next `verify` asks the database. */
const staleSocket = () => {
  const socket = socketWith();
  socket.data.session!.verifiedAt = -Infinity;
  return socket;
};

describe('SessionGate', () => {
  let reverify: ReturnType<typeof vi.fn<(identity: unknown) => Promise<Principal>>>;
  let ended: Array<[string, string]>;
  let reauth: Array<[string, string]>;
  let expired: boolean;
  let gate: SessionGate;

  beforeEach(() => {
    reverify = vi.fn<(identity: unknown) => Promise<Principal>>(() => Promise.resolve(principal));
    ended = [];
    reauth = [];
    expired = false;
    const authenticator = { reverify } as unknown as AccessTokenAuthenticator;
    const emitter = { end: (socket: RealtimeSocket, reason: string) => ended.push([socket.id, reason]) } as unknown as RealtimeEmitter;
    const expiry = { isExpired: () => expired, requireReauth: (socket: RealtimeSocket, reason: string) => reauth.push([socket.id, reason]) } as unknown as SessionExpiry;
    const logger = { warn: vi.fn(), error: vi.fn() } as unknown as JsonLogger;
    gate = new SessionGate(authenticator, new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 2 }), expiry, emitter, logger);
  });

  it('trusts a verification younger than a second without asking the database', async () => {
    expect(await gate.verify(socketWith())).toBe(principal);
    expect(reverify).not.toHaveBeenCalled();
  });

  it('re-verifies an older one with the session identity and remembers it', async () => {
    const socket = staleSocket();
    expect(await gate.verify(socket)).toBe(principal);
    expect(reverify).toHaveBeenCalledWith({ userId: 'u1', tenantId: 't1', sessionId: 's1' });
    expect(await gate.verify(socket)).toBe(principal);
    expect(reverify).toHaveBeenCalledTimes(1);
  });

  it('a check that predates `freshSince` does not count: an access signal always reaches the database', async () => {
    const socket = socketWith();
    await gate.verify(socket, monotonicNow() + 1);
    expect(reverify).toHaveBeenCalledTimes(1);
  });

  it('sockets of the same session share one check in flight', async () => {
    const [a, b] = [staleSocket(), staleSocket()];
    const results = await Promise.all([gate.verify(a), gate.verify(b)]);
    expect(results).toEqual([principal, principal]);
    expect(reverify).toHaveBeenCalledTimes(1);
  });

  it('a session the database refuses enters reauth and gets nothing', async () => {
    reverify.mockRejectedValueOnce(new UnauthenticatedError());
    const socket = staleSocket();
    expect(await gate.verify(socket)).toBeUndefined();
    expect(reauth).toEqual([[socket.id, 'SESSION_CHANGED']]);
    expect(ended).toEqual([]);
  });

  it('changed permissions end the socket', async () => {
    reverify.mockResolvedValueOnce({ ...principal, permissionsVersion: 2 });
    const socket = staleSocket();
    expect(await gate.verify(socket)).toBeUndefined();
    expect(ended).toEqual([[socket.id, 'PERMISSIONS_CHANGED']]);
  });

  it('a tenant policy failure ends the socket with its reason', async () => {
    reverify.mockRejectedValueOnce(new MfaRequiredError());
    const socket = staleSocket();
    expect(await gate.verify(socket)).toBeUndefined();
    expect(ended).toEqual([[socket.id, 'MFA_REQUIRED']]);
  });

  it('a transient failure sends nothing this time and keeps the socket', async () => {
    reverify.mockRejectedValueOnce(new TemporarilyUnavailableError(1));
    const socket = staleSocket();
    expect(await gate.verify(socket)).toBeUndefined();
    expect([ended, reauth]).toEqual([[], []]);
    expect(await gate.verify(socket)).toBe(principal);
  });

  it('an expired token asks for a new one without touching the database', async () => {
    expired = true;
    const socket = socketWith();
    expect(await gate.verify(socket)).toBeUndefined();
    expect(reauth).toEqual([[socket.id, 'TOKEN_EXPIRED']]);
    expect(reverify).not.toHaveBeenCalled();
  });

  it('a socket waiting for a new token or already ended gets nothing', async () => {
    const waiting = socketWith();
    waiting.data.session!.state = 'reauth';
    const gone = socketWith();
    gone.data.session!.ended = true;
    expect(await gate.verify(waiting)).toBeUndefined();
    expect(await gate.verify(gone)).toBeUndefined();
  });

  it('an answer about a session the socket already refreshed away from is ignored', async () => {
    let release!: (value: Principal) => void;
    reverify.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const socket = staleSocket();
    const pending = gate.verify(socket);
    socket.data.session!.principal = { ...principal, sessionId: 's2' };
    release({ ...principal, permissionsVersion: 9 });
    expect(await pending).toBeUndefined();
    expect(ended).toEqual([]);
  });

  it('a failure about a session the socket already refreshed away from is ignored too', async () => {
    let fail!: (error: unknown) => void;
    reverify.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    const socket = staleSocket();
    const pending = gate.verify(socket);
    socket.data.session!.principal = { ...principal, sessionId: 's2' };
    fail(new UnauthenticatedError());
    expect(await pending).toBeUndefined();
    expect([reauth, ended]).toEqual([[], []]);
  });

  it('a failure arriving after the socket ended is not acted on', async () => {
    let fail!: (error: unknown) => void;
    reverify.mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    const socket = staleSocket();
    const pending = gate.verify(socket);
    socket.data.session!.ended = true;
    fail(new MfaRequiredError());
    expect(await pending).toBeUndefined();
    expect([reauth, ended]).toEqual([[], []]);
  });
});
