import { describe, expect, it, vi } from 'vitest';
import { createInProcessLock, createWebLock } from './exclusive-lock';

describe('createInProcessLock', () => {
  it('runs one piece of work at a time, in order', async () => {
    const lock = createInProcessLock();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = lock.run(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      events.push('first:end');
    });
    const second = lock.run(async () => {
      events.push('second');
    });
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('keeps going after a failure', async () => {
    const lock = createInProcessLock();
    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

describe('createWebLock', () => {
  it('asks the Web Locks API for an exclusive lock with its name', async () => {
    const request = vi.fn((_name: string, _options: LockOptions, work: () => Promise<number>) => work());
    const lock = createWebLock('procesabpm.session.refresh', { request } as unknown as LockManager);
    await expect(lock.run(() => Promise.resolve(7))).resolves.toBe(7);
    expect(request).toHaveBeenCalledWith('procesabpm.session.refresh', { mode: 'exclusive' }, expect.any(Function));
  });
});
