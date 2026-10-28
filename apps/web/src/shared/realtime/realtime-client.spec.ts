import { describe, expect, it } from 'vitest';
import type { AccessToken } from '@/shared/session';
import { createTokenStore } from '@/shared/session';
import { createRealtimeClient, type RealtimeSocket } from './realtime-client';

const tokenOf = (value: string, sessionId = 's1'): AccessToken => ({ value, receivedAt: 0, expiresAt: 1, identity: { userId: 'u', tenantId: 't', sessionId } });

class FakeSocket implements RealtimeSocket {
  connected = false;
  readonly emitted: Array<[string, unknown]> = [];
  private readonly listeners = new Map<string, Array<(payload: never) => void>>();
  disconnected = false;

  constructor(readonly token: () => string | undefined) {}
  connect(): void {}
  disconnect(): void {
    this.disconnected = true;
    this.connected = false;
  }
  on(event: string, listener: (payload: never) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, body: unknown): void {
    this.emitted.push([event, body]);
  }
  /** The server side: fires an event at the client. */
  fire(event: string, payload?: unknown): void {
    if (event === 'connect') this.connected = true;
    for (const listener of this.listeners.get(event) ?? []) (listener as (value: unknown) => void)(payload);
  }
}

function setUp(initial: AccessToken | null = tokenOf('a')) {
  const tokens = createTokenStore();
  if (initial !== null) tokens.set(initial);
  const sockets: FakeSocket[] = [];
  const scheduled: Array<{ delayMs: number; run: () => void }> = [];
  const client = createRealtimeClient({
    tokens: { current: () => tokens.get(), subscribe: (listener) => tokens.subscribe(listener) },
    openSocket: (token) => {
      const socket = new FakeSocket(token);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
    schedule: (run, delayMs) => {
      const entry = { delayMs, run };
      scheduled.push(entry);
      return () => scheduled.splice(scheduled.indexOf(entry), 1);
    },
  });
  const last = () => sockets.at(-1)!;
  return { client, tokens, sockets, scheduled, last };
}

describe('createRealtimeClient', () => {
  it('opens one socket with the current token, and nothing without a session', () => {
    expect(setUp(null).sockets).toEqual([]);
    const { sockets, last, tokens } = setUp();
    expect(sockets).toHaveLength(1);
    expect(last().token()).toBe('a');
    tokens.set(tokenOf('b'));
    expect(last().token()).toBe('b');
  });

  it('tells its listeners when it connects and disconnects, and passes the AI and sync events on', () => {
    const { client, last } = setUp();
    const states: boolean[] = [];
    const changed: unknown[] = [];
    client.onConnectionChange((connected) => states.push(connected));
    client.on('ai_job.changed', (payload) => changed.push(payload));
    client.on('sync.required', (payload) => changed.push(payload));
    last().fire('connect');
    expect(client.isConnected()).toBe(true);
    last().fire('ai_job.changed', { jobId: 'j', versionId: 'v' });
    last().fire('sync.required', { reason: 'SIGNALS_MAY_BE_LOST', delayMs: 10 });
    last().fire('disconnect');
    expect(states).toEqual([true, false]);
    expect(changed).toEqual([{ jobId: 'j', versionId: 'v' }, { reason: 'SIGNALS_MAY_BE_LOST', delayMs: 10 }]);
  });

  it('follows a draft now and after every reconnection, and stops once the last follower leaves', () => {
    const { client, last, scheduled } = setUp();
    const unfollowFirst = client.followAiDraft('v1');
    const unfollowSecond = client.followAiDraft('v1');
    last().fire('connect');
    expect(last().emitted).toEqual([['ai_draft.subscribe', { versionId: 'v1' }]]);
    last().fire('disconnect');
    scheduled.shift()!.run();
    last().fire('connect');
    expect(last().emitted).toEqual([['ai_draft.subscribe', { versionId: 'v1' }]]);
    unfollowFirst();
    unfollowFirst();
    expect(last().emitted).toHaveLength(1);
    unfollowSecond();
    expect(last().emitted.at(-1)).toEqual(['ai_draft.unsubscribe', { versionId: 'v1' }]);
  });

  it('re-authenticates the socket with every new token of the same session, and on auth.required', () => {
    const { tokens, sockets, last } = setUp();
    last().fire('connect');
    tokens.set(tokenOf('b'));
    last().fire('auth.required', { reason: 'TOKEN_EXPIRED', graceMs: 10_000 });
    expect(sockets).toHaveLength(1);
    expect(last().emitted).toEqual([
      ['auth.refresh', { token: 'b' }],
      ['auth.refresh', { token: 'b' }],
    ]);
  });

  it('opens a new socket for another session and closes it when the session ends', () => {
    const { tokens, sockets } = setUp();
    tokens.set(tokenOf('c', 's2'));
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.disconnected).toBe(true);
    tokens.clear();
    expect(sockets[1]!.disconnected).toBe(true);
  });

  it('comes back after a refused connection or a server end that is not final, with a growing delay; not after REPLACED', () => {
    const { last, sockets, scheduled } = setUp();
    last().fire('connect_error', new Error('refused'));
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([2_000]);
    scheduled.shift()!.run();
    last().fire('connect_error', new Error('refused'));
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([4_000]);
    scheduled.shift()!.run();
    last().fire('connect');
    last().fire('session.ended', { reason: 'SERVER_SHUTDOWN' });
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([2_000]);
    scheduled.shift()!.run();
    const count = sockets.length;
    last().fire('connect');
    last().fire('session.ended', { reason: 'REPLACED' });
    last().fire('disconnect');
    expect(scheduled).toEqual([]);
    expect(sockets).toHaveLength(count);
  });

  it('closes everything on dispose', () => {
    const { client, last, tokens, sockets } = setUp();
    client.dispose();
    expect(last().disconnected).toBe(true);
    tokens.set(tokenOf('z', 's9'));
    expect(sockets).toHaveLength(1);
  });
});
