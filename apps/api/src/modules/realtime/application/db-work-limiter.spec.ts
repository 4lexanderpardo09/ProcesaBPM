import { TemporarilyUnavailableError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { DbWorkLimiter, MAX_WAITING } from './db-work-limiter.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('DbWorkLimiter', () => {
  it('never runs more than the configured number of jobs at once, and runs the rest in order', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    let peak = 0;
    const jobs = gates.map((gate, index) =>
      limiter.run(async () => {
        started.push(index);
        peak = Math.max(peak, limiter.inFlight);
        await gate.promise;
        return index;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(limiter.waiting).toBe(1);
    gates[0]!.resolve();
    await jobs[0];
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual([0, 1, 2]);
    gates[1]!.resolve();
    gates[2]!.resolve();
    expect(await Promise.all(jobs)).toEqual([0, 1, 2]);
    expect(peak).toBe(2);
    expect(limiter.inFlight).toBe(0);
  });

  it('passes the error of the work through', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 });
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(limiter.inFlight).toBe(0);
  });

  it('gives up on a caller that waits too long, without running its work later', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 });
    const blocker = deferred();
    const first = limiter.run(() => blocker.promise);
    let ran = false;
    const second = limiter.run(async () => {
      ran = true;
    }, 20);
    await expect(second).rejects.toBeInstanceOf(TemporarilyUnavailableError);
    expect(limiter.waiting).toBe(0);
    blocker.resolve();
    await first;
    expect(ran).toBe(false);
  });

  it('keeps the slot of work that outlived its timeout until it really ends', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 });
    const slow = deferred();
    await expect(limiter.run(() => slow.promise, 10)).rejects.toBeInstanceOf(TemporarilyUnavailableError);
    expect(limiter.inFlight).toBe(1);
    slow.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(limiter.inFlight).toBe(0);
  });

  it('refuses new work at once when the line is full', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 });
    const blocker = deferred();
    const running = limiter.run(() => blocker.promise);
    const waiting = Array.from({ length: MAX_WAITING }, () => limiter.run(() => Promise.resolve()));
    await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(TemporarilyUnavailableError);
    expect(limiter.waiting).toBe(MAX_WAITING);
    blocker.resolve();
    await Promise.all([running, ...waiting]);
  });

  it('lets interactive work (handshakes, refreshes) go ahead of background fan-out, in order among itself', async () => {
    const limiter = new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 1 });
    const blocker = deferred();
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(name);
    };
    const jobs = [
      limiter.run(() => blocker.promise),
      limiter.run(job('fan-out 1')),
      limiter.run(job('handshake 1'), undefined, 'interactive'),
      limiter.run(job('fan-out 2')),
      limiter.run(job('handshake 2'), undefined, 'interactive'),
    ];
    blocker.resolve();
    await Promise.all(jobs);
    expect(order).toEqual(['handshake 1', 'handshake 2', 'fan-out 1', 'fan-out 2']);
  });
});
