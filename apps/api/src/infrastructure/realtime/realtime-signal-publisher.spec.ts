import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../common/logging/json-logger.js';
import type { WorkerSettings } from '../../config/worker-settings.js';
import type { WorkerTransactionRunner } from '../database/worker-transaction-runner.js';
import { REALTIME_CHANNEL } from './realtime-signal.js';
import { RealtimeSignalPublisher } from './realtime-signal-publisher.js';

const id = (n: number) => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function setup(enabled = true) {
  const executed: unknown[][] = [];
  const tx = { $executeRaw: vi.fn(async (...args: unknown[]) => void executed.push(args)) };
  const runner = { withoutTenant: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(tx)) } as unknown as WorkerTransactionRunner;
  const publisher = new RealtimeSignalPublisher(runner, { REALTIME_SIGNALS_ENABLED: enabled } as WorkerSettings, { debug: vi.fn() } as unknown as JsonLogger);
  return { publisher, runner, executed };
}

describe('RealtimeSignalPublisher', () => {
  it('does nothing when signals are switched off or there are none', async () => {
    const off = setup(false);
    await off.publisher.publish([{ v: 1, k: 'ping', n: 'abcdefghij' }]);
    expect(off.runner.withoutTenant).not.toHaveBeenCalled();
    const empty = setup();
    await empty.publisher.publish([]);
    expect(empty.runner.withoutTenant).not.toHaveBeenCalled();
  });

  it('sends every payload in one short transaction, with the channel and payload as parameters', async () => {
    const { publisher, runner, executed } = setup();
    const users = Array.from({ length: 150 }, (_, index) => id(index + 10));
    await publisher.publish([{ v: 1, k: 'notifications', t: id(1), u: users }]);
    expect(runner.withoutTenant).toHaveBeenCalledTimes(1);
    expect(executed).toHaveLength(2);
    const [strings, channel, payload] = executed[0] as [TemplateStringsArray, string, string];
    expect(strings.join('?')).toBe('SELECT pg_notify(?, ?)');
    expect(channel).toBe(REALTIME_CHANNEL);
    expect(JSON.parse(payload)).toMatchObject({ k: 'notifications', t: id(1) });
  });
});
