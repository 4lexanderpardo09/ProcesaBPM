import { TemporarilyUnavailableError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { DbWorkLimiter } from './db-work-limiter.js';

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
});
