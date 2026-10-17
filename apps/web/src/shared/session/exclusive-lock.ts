/** Runs one piece of work at a time. */
export interface ExclusiveLock {
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** Across every tab of the browser profile (Web Locks API). */
export function createWebLock(name: string, locks: LockManager): ExclusiveLock {
  return { run: (work) => locks.request(name, { mode: 'exclusive' }, work) };
}

/** Within this tab only: the fallback without Web Locks, and the lock the unit tests share between fake tabs. */
export function createInProcessLock(): ExclusiveLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(work) {
      const result = tail.then(work);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
