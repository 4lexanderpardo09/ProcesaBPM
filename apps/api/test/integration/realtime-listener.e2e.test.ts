import { inject } from 'vitest';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../src/common/logging/json-logger.js';
import { PgSignalListener, pgListenerClientFactory } from '../../src/infrastructure/realtime/pg-signal-listener.js';
import { REALTIME_CHANNEL, type RealtimeSignal } from '../../src/infrastructure/realtime/realtime-signal.js';

const T = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';

const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as JsonLogger;

describe('PgSignalListener against a real PostgreSQL', () => {
  const url = inject('runtimeUrl');
  let sender: pg.Client;
  let listener: PgSignalListener;
  let received: RealtimeSignal[];
  let gaps: number;

  const notify = (payload: string) => sender.query('SELECT pg_notify($1, $2)', [REALTIME_CHANNEL, payload]);
  const listenerPid = async () => {
    const result = await sender.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity WHERE application_name = 'procesabpm-realtime-listener' AND datname = current_database()`);
    return result.rows[0]?.pid;
  };

  beforeEach(async () => {
    sender = new pg.Client({ connectionString: url });
    await sender.connect();
    received = [];
    gaps = 0;
    listener = new PgSignalListener(pgListenerClientFactory({ DATABASE_URL: url, REALTIME_DATABASE_URL: undefined }), silentLogger, { REALTIME_ENABLED: true });
    listener.onSignal((signal) => received.push(signal));
    listener.onGap(() => (gaps += 1));
    await listener.onApplicationBootstrap();
  });

  afterEach(async () => {
    await listener.beforeApplicationShutdown();
    await sender.end();
  });

  it('delivers valid signals and drops anything else', async () => {
    await notify('not json');
    await notify(JSON.stringify({ v: 1, k: 'ticket', t: T, id: ID, e: 'updated', extra: 1 }));
    await notify(JSON.stringify({ v: 1, k: 'notifications', t: T, u: [ID] }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ v: 1, k: 'notifications', t: T, u: [ID] });
    expect(listener.droppedSignals).toBe(2);
  });

  it('reconnects after its backend is terminated and announces the gap', async () => {
    const pid = await listenerPid();
    expect(pid).toBeDefined();
    const owner = new pg.Client({ connectionString: inject('ownerUrl') });
    await owner.connect();
    try {
      await owner.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await owner.end();
    }
    await vi.waitFor(() => expect(gaps).toBe(1), { timeout: 10_000, interval: 100 });
    await notify(JSON.stringify({ v: 1, k: 'notifications', t: T, u: [ID] }));
    await vi.waitFor(() => expect(received).toHaveLength(1));
  });
});
