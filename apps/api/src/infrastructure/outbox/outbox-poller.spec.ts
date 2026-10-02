import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../common/logging/json-logger.js';
import type { WorkerSettings } from '../../config/worker-settings.js';
import type { DispatchSummary, OutboxDispatcher } from './outbox-dispatcher.js';
import { OutboxPoller } from './outbox-poller.js';

const summary = (overrides: Partial<DispatchSummary> = {}): DispatchSummary => ({ claimed: 0, done: 0, retried: 0, failed: 0, stale: 0, full: false, ...overrides });
const settings = (enabled = true) => ({ OUTBOX_POLLING_ENABLED: enabled, OUTBOX_POLL_INTERVAL_MS: 60_000 }) as WorkerSettings;
const logger = { error: vi.fn() } as unknown as JsonLogger;

describe('OutboxPoller', () => {
  it('does nothing when polling is disabled', async () => {
    const runOnce = vi.fn();
    const poller = new OutboxPoller({ runOnce } as unknown as OutboxDispatcher, logger, settings(false));
    poller.onApplicationBootstrap();
    await poller.beforeApplicationShutdown();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('runs again right away while batches come back full, then sleeps', async () => {
    const results = [summary({ full: true }), summary({ full: true }), summary()];
    const runOnce = vi.fn(async () => results.shift() ?? summary());
    const poller = new OutboxPoller({ runOnce } as unknown as OutboxDispatcher, logger, settings());
    poller.onApplicationBootstrap();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(3));
    await poller.beforeApplicationShutdown();
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('on shutdown it wakes from its sleep and waits for the round in flight before returning', async () => {
    let finish: () => void = () => undefined;
    let finished = false;
    const runOnce = vi.fn(
      () =>
        new Promise<DispatchSummary>((resolve) => {
          finish = () => {
            finished = true;
            resolve(summary());
          };
        }),
    );
    const poller = new OutboxPoller({ runOnce } as unknown as OutboxDispatcher, logger, settings());
    poller.onApplicationBootstrap();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    const stopping = poller.beforeApplicationShutdown();
    await Promise.resolve();
    expect(finished).toBe(false);
    finish();
    await stopping;
    expect(finished).toBe(true);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('logs a failing round and keeps going', async () => {
    const results: Array<() => Promise<DispatchSummary>> = [() => Promise.reject(new Error('db down')), async () => summary({ full: true }), async () => summary()];
    const runOnce = vi.fn(() => (results.shift() ?? (async () => summary()))());
    const poller = new OutboxPoller({ runOnce } as unknown as OutboxDispatcher, logger, settings());
    poller.onApplicationBootstrap();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalled());
    await poller.beforeApplicationShutdown();
    expect(logger.error).toHaveBeenCalled();
  });
});
