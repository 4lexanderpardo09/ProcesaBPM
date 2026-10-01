import { InvalidStateError, mapDatabaseError, OverlapError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_RESPONSES } from '../../../common/http/error-responses.js';
import type { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { CalendarRepository, CalendarRow } from '../data/calendar.repository.js';
import { CalendarsService } from './calendars.service.js';

const calendar = (isDefault = false): CalendarRow => ({ id: 'cal', name: 'Main', countryCode: 'CO', isDefault, createdAt: new Date('2026-10-01T00:00:00Z') });

function build(stored: CalendarRow) {
  const repository = {
    findById: vi.fn().mockResolvedValue(stored),
    findWorkingHours: vi.fn().mockResolvedValue([]),
    replaceWorkingDay: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const runner = { withTenantTransaction: (work: (tx: unknown) => Promise<unknown>) => work({}) } as unknown as TenantTransactionRunner;
  const context = { require: () => ({ tenantId: 't', userId: 'u' }) } as unknown as TenantContext;
  return { service: new CalendarsService(runner, context, repository as unknown as CalendarRepository), repository };
}

describe('CalendarsService', () => {
  it('the default calendar cannot be deleted', async () => {
    const { service, repository } = build(calendar(true));
    await expect(service.remove('cal')).rejects.toBeInstanceOf(InvalidStateError);
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('overlapping slots: the exclusion violation of the database (23P01) becomes an OverlapError answered with 409', async () => {
    const prismaLike = Object.assign(new Error('conflicting key value violates exclusion constraint "working_hours_no_overlap"'), {
      meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
    });
    const { service, repository } = build(calendar());
    repository.replaceWorkingDay.mockRejectedValue(prismaLike);

    const failure = await service.replaceWorkingDay('cal', 1, { slots: [] }).catch((error: unknown) => error);
    const mapped = mapDatabaseError(failure);
    expect(mapped).toBeInstanceOf(OverlapError);
    expect(ERROR_RESPONSES[mapped!.code].status).toBe(409);
  });
});
