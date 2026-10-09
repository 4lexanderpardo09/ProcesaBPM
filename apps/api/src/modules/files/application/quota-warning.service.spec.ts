import { describe, expect, it } from 'vitest';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { LockedUsage, StorageQuotaEventPayload, TenantUsageRepository } from '../data/tenant-usage.repository.js';
import type { QuotaWarningLevel } from '../domain/quota-policy.js';
import { QuotaWarningService } from './quota-warning.service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const tx = {} as TenantTransaction;

function setup(limitBytes = 1000n) {
  const levels: QuotaWarningLevel[] = [];
  const queued: StorageQuotaEventPayload[] = [];
  const usage = {
    termsOf: async () => ({ baseBytes: limitBytes, perUserBytes: 0n, gracePercent: 10, extraBytes: 0n, activeUsers: 1 }),
    setWarningLevel: async (_tx: unknown, _tenant: string, level: QuotaWarningLevel) => void levels.push(level),
    queueWarning: async (_tx: unknown, _tenant: string, payload: StorageQuotaEventPayload) => void queued.push(payload),
  } as unknown as TenantUsageRepository;
  return { service: new QuotaWarningService(usage), levels, queued };
}

const before = (warningLevel: QuotaWarningLevel, usedBytes = 0n): LockedUsage => ({ usedBytes, reservedBytes: 0n, warningLevel });

describe('QuotaWarningService.sync', () => {
  it('crossing a threshold records it and queues one warning with the figures', async () => {
    const { service, levels, queued } = setup();
    await service.sync(tx, TENANT, before(0), 850n);
    expect(levels).toEqual([80]);
    expect(queued).toEqual([{ level: 80, usedBytes: '850', limitBytes: '1000' }]);
  });

  it('jumping straight past 95 % warns once, at 95', async () => {
    const { service, queued } = setup();
    await service.sync(tx, TENANT, before(0), 990n);
    expect(queued.map((payload) => payload.level)).toEqual([95]);
  });

  it('staying at the announced level does nothing', async () => {
    const { service, levels, queued } = setup();
    await service.sync(tx, TENANT, before(80), 900n);
    expect(levels).toEqual([]);
    expect(queued).toEqual([]);
  });

  it('falling below (or a larger limit) lowers the level silently, so the next crossing warns again', async () => {
    const { service, levels, queued } = setup(2000n);
    await service.sync(tx, TENANT, before(95), 1000n);
    expect(levels).toEqual([0]);
    expect(queued).toEqual([]);
  });
});
