import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../infrastructure/clock.js';
import { ExportLeaseLostError } from '../domain/export-errors.js';
import { EXPORT_LEASE_SAFETY_MS, ExportLease } from './export-lease.js';

function lease(answers: Array<boolean | Error>) {
  let now = 0;
  const onError = vi.fn();
  const renew = vi.fn(async () => {
    const answer = answers.shift() ?? true;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { lease: new ExportLease(renew, { now: () => new Date(now) } as Clock, onError), renew, onError, advance: (ms: number) => (now += ms) };
}

describe('ExportLease', () => {
  it('stays alive while renewals succeed', async () => {
    const { lease: subject } = lease([true, true]);
    await subject.beat();
    await subject.confirm();
    expect(subject.signal.aborted).toBe(false);
  });

  it('is lost at the first refused renewal, and confirm throws from then on', async () => {
    const { lease: subject, renew } = lease([false]);
    await subject.beat();
    expect(subject.signal.reason).toBeInstanceOf(ExportLeaseLostError);
    await expect(subject.confirm()).rejects.toBeInstanceOf(ExportLeaseLostError);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('survives failing renewals for a while, and gives up before the lease could have ended', async () => {
    const { lease: subject, onError, advance } = lease([new Error('db down'), new Error('db down')]);
    await subject.beat();
    expect(subject.signal.aborted).toBe(false);
    advance(EXPORT_LEASE_SAFETY_MS + 1);
    await subject.beat();
    expect(subject.signal.reason).toBeInstanceOf(ExportLeaseLostError);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('never runs two renewals at once', async () => {
    const { lease: subject, renew } = lease([true]);
    await Promise.all([subject.beat(), subject.beat()]);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
