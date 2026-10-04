import { ExportExpiredError, ExportNotReadyError, InvalidCredentialsError, NotFoundError, PermissionDeniedError, RateLimitedError, StorageUnavailableError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { InMemoryRateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import type { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import type { AuditTrail } from '../../audit/application/audit-trail.js';
import type { CurrentPasswordVerifier } from '../../auth/application/current-password-verifier.js';
import type { DataExportRepository } from '../data/data-export.repository.js';
import { DataExportDownloadsService } from './data-export-downloads.service.js';

const admin: Principal = {
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: true,
  isOwner: false,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null },
  tenantMode: 'DELETION_PENDING',
};
const now = new Date('2026-10-04T12:00:00Z');
const downloadable = { storageKey: 'tenants/t1/exports/x1.zip', expiresAt: new Date(now.getTime() + 86_400_000), completedAt: new Date('2026-10-03T08:00:00Z') };
const body = { currentPassword: 'secret' };

function setup() {
  const clock = { now: () => now } as Clock;
  const order: string[] = [];
  const repository = {
    findDownloadable: vi.fn(async (): Promise<typeof downloadable | undefined> => downloadable),
    countDownload: vi.fn(async (): Promise<number | undefined> => (order.push('count'), 2)),
    find: vi.fn(async (): Promise<{ status: string } | undefined> => undefined),
    findSlug: vi.fn(async () => 'acme'),
  };
  const record = vi.fn(async () => void order.push('audit'));
  const verify = vi.fn(async () => void order.push('password'));
  const presignDownload = vi.fn(async (input: { expiresInSeconds: number }) => (order.push('sign'), { url: 'https://s3.test/signed', expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000) }));
  const service = new DataExportDownloadsService(
    { withTenantTransaction: async <T>(work: (tx: unknown) => Promise<T>) => work({}) } as unknown as TenantTransactionRunner,
    repository as unknown as DataExportRepository,
    { verify } as unknown as CurrentPasswordVerifier,
    { presignDownload } as unknown as ObjectStorage,
    { record } as unknown as AuditTrail,
    new InMemoryRateLimiter(clock),
    clock,
  );
  return { service, repository, record, verify, presignDownload, order };
}

describe('DataExportDownloadsService', () => {
  it('checks the password, signs a 5-minute attachment link named after the organization, then counts and audits it', async () => {
    const { service, record, verify, presignDownload, order } = setup();
    await expect(service.issueUrl(admin, 'x1', body)).resolves.toEqual({ url: 'https://s3.test/signed', expiresAt: new Date(now.getTime() + 300_000).toISOString() });
    expect(verify).toHaveBeenCalledWith('u1', 'secret');
    expect(order).toEqual(['password', 'sign', 'count', 'audit']);
    expect(record).toHaveBeenCalledWith({}, { action: 'data_export.download_url_issued', subjectType: 'DataExport', subjectId: 'x1', after: { downloadCount: 2 } });
    expect(presignDownload).toHaveBeenCalledWith({ key: downloadable.storageKey, fileName: 'acme-export-2026-10-03.zip', contentType: 'application/zip', disposition: 'attachment', expiresInSeconds: 300, now });
  });

  it('records nothing when the link cannot be signed', async () => {
    const { service, repository, record, presignDownload } = setup();
    presignDownload.mockRejectedValue(new StorageUnavailableError());
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(repository.countDownload).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('drops the signed link when the export expired in between', async () => {
    const { service, repository, record } = setup();
    repository.countDownload.mockResolvedValue(undefined);
    repository.find.mockResolvedValue({ status: 'EXPIRED' });
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(ExportExpiredError);
    expect(record).not.toHaveBeenCalled();
  });

  it('stops at a wrong password, before reading the export', async () => {
    const { service, repository, verify } = setup();
    verify.mockRejectedValue(new InvalidCredentialsError());
    await expect(service.issueUrl(admin, 'x1', { currentPassword: 'wrong' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repository.findDownloadable).not.toHaveBeenCalled();
  });

  it('explains why nothing can be downloaded, without signing, counting or auditing', async () => {
    const { service, repository, record, presignDownload } = setup();
    repository.findDownloadable.mockResolvedValue(undefined);
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(NotFoundError);
    repository.find.mockResolvedValue({ status: 'RUNNING' });
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(ExportNotReadyError);
    repository.find.mockResolvedValue({ status: 'EXPIRED' });
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(ExportExpiredError);
    expect(presignDownload).not.toHaveBeenCalled();
    expect(repository.countDownload).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('issues at most 10 links per person and hour, before spending a password attempt', async () => {
    const { service, verify } = setup();
    for (let i = 0; i < 10; i += 1) await service.issueUrl(admin, 'x1', body);
    await expect(service.issueUrl(admin, 'x1', body)).rejects.toBeInstanceOf(RateLimitedError);
    expect(verify).toHaveBeenCalledTimes(10);
    await expect(service.issueUrl({ ...admin, userId: 'u2' }, 'x1', body)).resolves.toBeDefined();
  });

  it('refuses a member without full access and a support visit, without a password attempt', async () => {
    const { service, repository, verify } = setup();
    await expect(service.issueUrl({ ...admin, roleIsAdmin: false }, 'x1', body)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.issueUrl({ ...admin, support: { grantId: 'g1' } }, 'x1', body)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(verify).not.toHaveBeenCalled();
    expect(repository.findDownloadable).not.toHaveBeenCalled();
  });
});
