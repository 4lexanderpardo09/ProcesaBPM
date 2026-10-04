import { DuplicateError, ExportInProgressError, InvalidCredentialsError, PermissionDeniedError, RateLimitedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import type { AuditTrail } from '../../audit/application/audit-trail.js';
import type { CurrentPasswordVerifier } from '../../auth/application/current-password-verifier.js';
import type { DataExportRepository } from '../data/data-export.repository.js';
import { DataExportRequestsService } from './data-export-requests.service.js';

const owner: Principal = {
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: true,
  isOwner: true,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null },
  tenantMode: 'DELETION_PENDING',
};
const now = new Date('2026-10-04T12:00:00Z');
const created = { id: 'x1', status: 'PENDING' };

function setup() {
  const order: string[] = [];
  const verify = vi.fn(async () => void order.push('password'));
  const hit = vi.fn(async () => (order.push('rate'), { allowed: true, retryAfterSeconds: 0 }));
  const repository = {
    findTenantDeadline: vi.fn(async () => ({ status: 'PENDING_DELETION', purgeAfter: new Date(now.getTime() + 10 * 86_400_000) })),
    countRequests: vi.fn(async () => ({ requests: 0, inFlight: 0 })),
    create: vi.fn(async () => (order.push('insert'), created)),
  };
  const record = vi.fn(async () => undefined);
  const runner = { withTenantTransaction: vi.fn(async <T>(work: (tx: unknown) => Promise<T>) => work({})) };
  const service = new DataExportRequestsService(
    runner as unknown as TenantTransactionRunner,
    repository as unknown as DataExportRepository,
    { verify } as unknown as CurrentPasswordVerifier,
    { record } as unknown as AuditTrail,
    { hit } as unknown as RateLimiter,
    { now: () => now } as Clock,
  );
  return { service, order, verify, hit, repository, record, runner };
}

describe('DataExportRequestsService.request', () => {
  it('checks who asks, the rate, then the password, and records the request with its audit row', async () => {
    const { service, order, record, repository } = setup();
    await expect(service.request(owner, { currentPassword: 'secret', includeFiles: false })).resolves.toBe(created);
    expect(order).toEqual(['rate', 'password', 'insert']);
    expect(repository.create).toHaveBeenCalledWith({}, { tenantId: 't1', requestedById: 'u1', includeFiles: false });
    expect(record).toHaveBeenCalledWith({}, { action: 'data_export.requested', subjectType: 'DataExport', subjectId: 'x1', after: { includeFiles: false } });
  });

  it('never spends a password attempt for a caller who could never export', async () => {
    const { service, verify, hit } = setup();
    await expect(service.request({ ...owner, isOwner: false, roleIsAdmin: false }, { currentPassword: 'secret', includeFiles: true })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(hit).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('stops at a wrong password, before touching the organization', async () => {
    const { service, verify, runner } = setup();
    verify.mockRejectedValue(new InvalidCredentialsError());
    await expect(service.request(owner, { currentPassword: 'wrong', includeFiles: true })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(runner.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('stops a flood before the password check', async () => {
    const { service, verify, hit } = setup();
    hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    await expect(service.request(owner, { currentPassword: 'secret', includeFiles: true })).rejects.toBeInstanceOf(RateLimitedError);
    expect(verify).not.toHaveBeenCalled();
  });

  it('answers 409 EXPORT_IN_PROGRESS when another request won the race (unique violation)', async () => {
    const { service, repository } = setup();
    repository.create.mockRejectedValue(Object.assign(new DuplicateError('dup'), { cause: { code: '23505' } }));
    await expect(service.request(owner, { currentPassword: 'secret', includeFiles: true })).rejects.toBeInstanceOf(ExportInProgressError);
  });
});
