import { ExportExpiredError, ExportNotReadyError, NotFoundError, PermissionDeniedError, RateLimitedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { InMemoryRateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import type { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import type { AuditTrail } from '../../audit/application/audit-trail.js';
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
const counted = { storageKey: 'tenants/t1/exports/x1.zip', expiresAt: new Date(now.getTime() + 86_400_000), completedAt: new Date('2026-10-03T08:00:00Z'), downloadCount: 2 };

function setup() {
  const clock = { now: () => now } as Clock;
  const repository = {
    countDownload: vi.fn(async (): Promise<typeof counted | undefined> => counted),
    find: vi.fn(async (): Promise<{ status: string } | undefined> => undefined),
    findSlug: vi.fn(async () => 'acme'),
  };
  const record = vi.fn(async () => undefined);
  const presignDownload = vi.fn(async (input: { expiresInSeconds: number }) => ({ url: 'https://s3.test/signed', expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000) }));
  const service = new DataExportDownloadsService(
    { withTenantTransaction: async <T>(work: (tx: unknown) => Promise<T>) => work({}) } as unknown as TenantTransactionRunner,
    repository as unknown as DataExportRepository,
    { presignDownload } as unknown as ObjectStorage,
    { record } as unknown as AuditTrail,
    new InMemoryRateLimiter(clock),
    clock,
  );
  return { service, repository, record, presignDownload };
}

describe('DataExportDownloadsService', () => {
  it('counts and audits the download, and signs a 5-minute attachment link named after the organization', async () => {
    const { service, record, presignDownload } = setup();
    await expect(service.issueUrl(admin, 'x1')).resolves.toEqual({ url: 'https://s3.test/signed', expiresAt: new Date(now.getTime() + 300_000).toISOString() });
    expect(record).toHaveBeenCalledWith({}, { action: 'data_export.download_url_issued', subjectType: 'DataExport', subjectId: 'x1', after: { downloadCount: 2 } });
    expect(presignDownload).toHaveBeenCalledWith({ key: counted.storageKey, fileName: 'acme-export-2026-10-03.zip', contentType: 'application/zip', disposition: 'attachment', expiresInSeconds: 300, now });
  });

  it('explains why nothing can be downloaded, without auditing or signing', async () => {
    const { service, repository, record, presignDownload } = setup();
    repository.countDownload.mockResolvedValue(undefined);
    await expect(service.issueUrl(admin, 'x1')).rejects.toBeInstanceOf(NotFoundError);
    repository.find.mockResolvedValue({ status: 'RUNNING' });
    await expect(service.issueUrl(admin, 'x1')).rejects.toBeInstanceOf(ExportNotReadyError);
    repository.find.mockResolvedValue({ status: 'EXPIRED' });
    await expect(service.issueUrl(admin, 'x1')).rejects.toBeInstanceOf(ExportExpiredError);
    expect(record).not.toHaveBeenCalled();
    expect(presignDownload).not.toHaveBeenCalled();
  });

  it('issues at most 10 links per person and hour', async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i += 1) await service.issueUrl(admin, 'x1');
    await expect(service.issueUrl(admin, 'x1')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(service.issueUrl({ ...admin, userId: 'u2' }, 'x1')).resolves.toBeDefined();
  });

  it('refuses a member without full access and a support visit', async () => {
    const { service, repository } = setup();
    await expect(service.issueUrl({ ...admin, roleIsAdmin: false }, 'x1')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.issueUrl({ ...admin, support: { grantId: 'g1' } }, 'x1')).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(repository.countDownload).not.toHaveBeenCalled();
  });
});
