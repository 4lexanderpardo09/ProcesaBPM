import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../common/logging/json-logger.js';
import { type ListenerClient, PgSignalListener, SELF_PING_INTERVAL_MS, SELF_PING_TIMEOUT_MS } from './pg-signal-listener.js';
import { REALTIME_CHANNEL } from './realtime-signal.js';

const T = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const U = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';

class FakeClient implements ListenerClient {
  readonly queries: Array<{ text: string; values?: unknown[] | undefined }> = [];
  ended = false;
  failConnect = false;
  private handlers: Record<string, Array<(...args: never[]) => void>> = {};
  connect = vi.fn(async () => {
    if (this.failConnect) throw new Error('refused');
  });
  query = vi.fn(async (text: string, values?: unknown[]) => {
    this.queries.push({ text, values });
  });
  on(event: string, listener: (...args: never[]) => void): this {
    (this.handlers[event] ??= []).push(listener);
    return this;
  }
  async end(): Promise<void> {
    this.ended = true;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers[event] ?? []) (handler as (...a: unknown[]) => void)(...args);
  }
  notify(payload: string): void {
    this.emit('notification', { channel: REALTIME_CHANNEL, payload });
  }
  /** What the self-ping sent, as the database would echo it back. */
  lastPing(): string {
    return this.queries.filter((q) => q.text.startsWith('SELECT pg_notify')).at(-1)!.values![1] as string;
  }
}

function setup(enabled = true) {
  const clients: FakeClient[] = [];
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as JsonLogger;
  const listener = new PgSignalListener(
    () => {
      const client = new FakeClient();
      client.failConnect = failNext.count > 0 && (failNext.count -= 1, true);
      clients.push(client);
      return client;
    },
    logger,
    { REALTIME_ENABLED: enabled },
  );
  const signals: unknown[] = [];
  const gaps = vi.fn();
  listener.onSignal((signal) => signals.push(signal));
  listener.onGap(gaps);
  return { listener, clients, signals, gaps, logger };
}
const failNext = { count: 0 };

describe('PgSignalListener', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    failNext.count = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('listens on the channel and hands decoded signals to its listeners, dropping anything that is not exactly a signal', async () => {
    const { listener, clients, signals } = setup();
    await listener.onApplicationBootstrap();
    expect(clients[0]!.queries[0]!.text).toBe(`LISTEN ${REALTIME_CHANNEL}`);

    clients[0]!.notify(JSON.stringify({ v: 1, k: 'notifications', t: T, u: [U] }));
    clients[0]!.notify('not json');
    clients[0]!.notify(JSON.stringify({ v: 1, k: 'ticket', t: T, id: U, e: 'ticket.created', extra: 'key' }));
    clients[0]!.notify(JSON.stringify({ v: 2, k: 'notifications', t: T, u: [U] }));
    clients[0]!.emit('notification', { channel: 'another_channel', payload: JSON.stringify({ v: 1, k: 'notifications', t: T, u: [U] }) });

    expect(signals).toEqual([{ v: 1, k: 'notifications', t: T, u: [U] }]);
    expect(listener.droppedSignals).toBe(3);
  });

  it('does nothing when the gateway is disabled', async () => {
    const { listener, clients } = setup(false);
    await listener.onApplicationBootstrap();
    expect(clients).toHaveLength(0);
  });

  it('sends itself a ping every 30 s and stays connected while the echo arrives; the ping is not a signal', async () => {
    const { listener, clients, signals, gaps } = setup();
    await listener.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SELF_PING_INTERVAL_MS);
    const ping = clients[0]!.lastPing();
    expect(JSON.parse(ping)).toMatchObject({ v: 1, k: 'ping' });
    clients[0]!.notify(ping);
    await vi.advanceTimersByTimeAsync(SELF_PING_TIMEOUT_MS + 1);

    expect(clients).toHaveLength(1);
    expect(clients[0]!.ended).toBe(false);
    expect(signals).toEqual([]);
    expect(gaps).not.toHaveBeenCalled();
  });

  it('a ping nobody echoes (a pooler in transaction mode) drops the connection, reconnects and announces the gap', async () => {
    const { listener, clients, gaps, logger } = setup();
    await listener.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SELF_PING_INTERVAL_MS + SELF_PING_TIMEOUT_MS);

    expect(clients[0]!.ended).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('realtime.listener_unhealthy'), undefined, 'PgSignalListener');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    expect(clients[1]!.queries[0]!.text).toBe(`LISTEN ${REALTIME_CHANNEL}`);
    expect(gaps).toHaveBeenCalledTimes(1);
  });

  it('a stale echo (another nonce) does not count as proof of life', async () => {
    const { listener, clients } = setup();
    await listener.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SELF_PING_INTERVAL_MS);
    clients[0]!.notify(JSON.stringify({ v: 1, k: 'ping', n: 'someone-elses-nonce' }));
    await vi.advanceTimersByTimeAsync(SELF_PING_TIMEOUT_MS);
    expect(clients[0]!.ended).toBe(true);
  });

  it('reconnects after an error, backing off 1 s, 2 s, 4 s… up to 30 s, and the first connection announces no gap', async () => {
    const { listener, clients, gaps } = setup();
    await listener.onApplicationBootstrap();
    expect(gaps).not.toHaveBeenCalled();

    clients[0]!.emit('error', new Error('terminating connection'));
    await vi.advanceTimersByTimeAsync(999);
    expect(clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(2);
    expect(gaps).toHaveBeenCalledTimes(1);

    // Two failed attempts in a row, then it works: delays of 1 s and 2 s.
    failNext.count = 2;
    clients[1]!.emit('end');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(clients).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(clients).toHaveLength(5);
    expect(gaps).toHaveBeenCalledTimes(2);
  });

  it('keeps trying when the first connection fails, without crashing the application', async () => {
    failNext.count = 1;
    const { listener, clients, gaps } = setup();
    await expect(listener.onApplicationBootstrap()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    // The first successful connection is the first one: nothing was lost that anyone had seen.
    expect(gaps).not.toHaveBeenCalled();
  });

  it('on shutdown stops listening, closes the connection and does not reconnect', async () => {
    const { listener, clients } = setup();
    await listener.onApplicationBootstrap();
    await listener.beforeApplicationShutdown();
    expect(clients[0]!.queries.at(-1)!.text).toBe('UNLISTEN *');
    expect(clients[0]!.ended).toBe(true);
    clients[0]!.emit('end');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
  });

  it('a listener that throws does not stop the others', async () => {
    const { listener, clients, signals } = setup();
    listener.onSignal(() => {
      throw new Error('boom');
    });
    await listener.onApplicationBootstrap();
    clients[0]!.notify(JSON.stringify({ v: 1, k: 'notifications', t: T, u: [U] }));
    expect(signals).toHaveLength(1);
  });
});
