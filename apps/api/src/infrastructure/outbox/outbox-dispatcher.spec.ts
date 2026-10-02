import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { JsonLogger } from '../../common/logging/json-logger.js';
import type { WorkerSettings } from '../../config/worker-settings.js';
import type { WorkerTransactionRunner } from '../database/worker-transaction-runner.js';
import type { OutboxClaimsRepository } from './outbox-claims.repository.js';
import { type ClaimedEvent, PermanentEventError } from './outbox-handler.js';
import { OutboxHandlerRegistry } from './outbox-handler.registry.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { MAX_ATTEMPTS } from './retry-policy.js';
import { TestClock } from '../../../test/support/test-clock.js';

const NOW = '2026-10-02T10:00:00Z';
const event = (overrides: Partial<ClaimedEvent<unknown>> = {}): ClaimedEvent<unknown> => ({ id: 'e1', tenantId: 't1', type: 'demo', attempt: 1, createdAt: new Date(NOW), payload: { value: 1 }, ...overrides });

function setup(claimed: ClaimedEvent<unknown>[], options: { completes?: boolean; batch?: number; concurrency?: number } = {}) {
  let inTransaction = false;
  const calls: string[] = [];
  const fails: Array<{ error: string; retryAt: Date | null }> = [];
  const warnings: unknown[] = [];
  let running = 0;
  let peak = 0;
  const tx = {} as never;
  const runner = {
    withoutTenant: async (work: (tx: never) => Promise<unknown>) => work(tx),
    withTenant: async (_tenantId: string, work: (tx: never) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await work(tx);
      } finally {
        inTransaction = false;
      }
    },
  } as unknown as WorkerTransactionRunner;
  const claims = {
    claimTenant: async () => claimed,
    claimPlatform: async () => [],
    complete: async () => {
      calls.push('complete');
      return options.completes ?? true;
    },
    fail: async (_tx: unknown, _source: string, _event: unknown, error: string, retryAt: Date | null) => {
      fails.push({ error, retryAt });
      return true;
    },
  } as unknown as OutboxClaimsRepository;
  const registry = new OutboxHandlerRegistry();
  const logger = { warn: (message: unknown) => warnings.push(message), error: (message: unknown) => warnings.push(message) } as unknown as JsonLogger;
  const settings = { OUTBOX_BATCH_SIZE: options.batch ?? 10, OUTBOX_CONCURRENCY: options.concurrency ?? 4, OUTBOX_TX_TIMEOUT_MS: 1000 } as WorkerSettings;
  const dispatcher = new OutboxDispatcher(runner, registry, claims, new TestClock(NOW), logger, settings);
  return { dispatcher, registry, calls, fails, warnings, inTransaction: () => inTransaction, concurrency: { enter: () => { running += 1; peak = Math.max(peak, running); }, leave: () => { running -= 1; }, peak: () => peak } };
}

const schema = z.object({ value: z.number() });

describe('OutboxDispatcher', () => {
  it('runs transactional handlers and completes the event in the same transaction', async () => {
    const { dispatcher, registry, calls } = setup([event()]);
    registry.registerTransactional({ type: 'demo', schema, handle: async () => void calls.push('handle') });
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    expect(calls).toEqual(['handle', 'complete']);
  });

  it('a lost claim rolls the work back and is not recorded as a failure', async () => {
    const { dispatcher, registry, fails } = setup([event()], { completes: false });
    registry.registerTransactional({ type: 'demo', schema, handle: () => Promise.resolve() });
    expect(await dispatcher.runOnce()).toMatchObject({ done: 0, stale: 1 });
    expect(fails).toEqual([]);
  });

  it('retries a failing handler with backoff, recording only the kind of error', async () => {
    const { dispatcher, registry, fails } = setup([event({ attempt: 2 })]);
    registry.registerTransactional({ type: 'demo', schema, handle: () => Promise.reject(Object.assign(new Error('secret@example.com'), { code: 'ECONNRESET' })) });
    expect(await dispatcher.runOnce()).toMatchObject({ retried: 1, failed: 0 });
    expect(fails[0]!.error).toBe('Error:ECONNRESET');
    const delay = fails[0]!.retryAt!.getTime() - new Date(NOW).getTime();
    expect(delay).toBeGreaterThanOrEqual(48_000);
    expect(delay).toBeLessThanOrEqual(72_000);
  });

  it.each([
    ['a permanent error', (): Promise<void> => Promise.reject(new PermanentEventError('nope')), { value: 1 }],
    ['a payload that does not match the schema', (): Promise<void> => Promise.resolve(), { value: 'x' }],
  ])('sends %s straight to FAILED', async (_label, handle, payload) => {
    const { dispatcher, registry, fails } = setup([event({ payload })]);
    registry.registerTransactional({ type: 'demo', schema, handle });
    expect(await dispatcher.runOnce()).toMatchObject({ failed: 1, retried: 0 });
    expect(fails[0]!.retryAt).toBeNull();
  });

  it('the last attempt is terminal even for an ordinary error', async () => {
    const { dispatcher, registry, fails } = setup([event({ attempt: MAX_ATTEMPTS })]);
    registry.registerTransactional({ type: 'demo', schema, handle: () => Promise.reject(new Error('boom')) });
    expect(await dispatcher.runOnce()).toMatchObject({ failed: 1 });
    expect(fails[0]!.retryAt).toBeNull();
  });

  it('an external effect runs outside any transaction, between its prepare and its completion', async () => {
    const { dispatcher, registry, calls, inTransaction } = setup([event()]);
    registry.registerExternal({
      type: 'demo',
      scope: 'tenant',
      schema,
      prepare: async () => {
        calls.push(`prepare:${inTransaction()}`);
        return { to: 'x' };
      },
      perform: async () => void calls.push(`perform:${inTransaction()}`),
    });
    await dispatcher.runOnce();
    expect(calls).toEqual(['prepare:true', 'perform:false', 'complete']);
  });

  it('sends nothing when prepare has nothing to send, and still completes', async () => {
    const { dispatcher, registry, calls } = setup([event()]);
    registry.registerExternal({ type: 'demo', scope: 'tenant', schema, prepare: () => Promise.resolve(null), perform: async () => void calls.push('perform') });
    expect(await dispatcher.runOnce()).toMatchObject({ done: 1 });
    expect(calls).toEqual(['complete']);
  });

  it('a delivery error is retried, and a permanent one (flagged by the mailer) is not', async () => {
    const transient = setup([event()]);
    transient.registry.registerExternal({ type: 'demo', scope: 'tenant', schema, prepare: () => Promise.resolve({}), perform: () => Promise.reject(new Error('timeout')) });
    expect(await transient.dispatcher.runOnce()).toMatchObject({ retried: 1 });
    const permanent = setup([event()]);
    permanent.registry.registerExternal({ type: 'demo', scope: 'tenant', schema, prepare: () => Promise.resolve({}), perform: () => Promise.reject(Object.assign(new Error('550'), { permanent: true })) });
    expect(await permanent.dispatcher.runOnce()).toMatchObject({ failed: 1 });
  });

  it('claims nothing while no tenant type has a handler', async () => {
    const { dispatcher } = setup([event()]);
    expect(await dispatcher.runOnce()).toMatchObject({ claimed: 0 });
  });

  it('processes at most `concurrency` events at once and reports a full batch', async () => {
    const events = Array.from({ length: 9 }, (_v, index) => event({ id: `e${index}` }));
    const ctx = setup(events, { batch: 9, concurrency: 3 });
    ctx.registry.registerTransactional({
      type: 'demo',
      schema,
      handle: async () => {
        ctx.concurrency.enter();
        await new Promise((resolve) => setTimeout(resolve, 5));
        ctx.concurrency.leave();
      },
    });
    expect(await ctx.dispatcher.runOnce()).toMatchObject({ claimed: 9, done: 9, full: true });
    expect(ctx.concurrency.peak()).toBe(3);
  });

  it('never logs payload data', async () => {
    const { dispatcher, registry, warnings } = setup([event({ payload: { value: 1, email: 'leak@example.com' } })]);
    registry.registerTransactional({ type: 'demo', schema: z.object({ value: z.number() }).passthrough(), handle: () => Promise.reject(new Error('leak@example.com')) });
    await dispatcher.runOnce();
    expect(JSON.stringify(warnings)).not.toContain('leak@example.com');
  });
});
