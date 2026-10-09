import { describe, expect, it } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { StoredFileRepository } from '../data/stored-file.repository.js';
import type { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import type { TicketDocumentRepository } from '../data/ticket-document.repository.js';
import type { QuotaWarningService } from './quota-warning.service.js';
import { type GeneratedDocument, SystemFileService } from './system-file.service.js';

const TENANT = '0199a000-0000-7000-8000-000000000001';
const document: GeneratedDocument = {
  fileId: '0199a000-0000-8000-8000-000000000002',
  storageKey: 'tenants/t/2026/10/f',
  fileName: 'a.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 500,
  sha256: 'a'.repeat(64),
  ticketId: '0199a000-0000-7000-8000-000000000003',
  role: 'MAIN_DOCUMENT',
  stepId: null,
  eventId: '0199a000-0000-7000-8000-000000000004',
  at: new Date('2026-10-02T10:00:00Z'),
};

function setup(options: { recorded?: boolean; used?: bigint; terms?: { base: bigint } } = {}) {
  const calls: string[] = [];
  const warnings: unknown[] = [];
  const files = {
    companyOfTicket: async () => 'company',
    insertSystemFile: async () => void calls.push('insertFile'),
  } as unknown as StoredFileRepository;
  const usage = {
    lock: async () => (calls.push('lockUsage'), { usedBytes: options.used ?? 0n, reservedBytes: 0n }),
    adjust: async (_tx: unknown, _tenant: string, delta: { usedBytes?: bigint }) => void calls.push(`adjust:${delta.usedBytes}`),
    termsOf: async () => ({ baseBytes: options.terms?.base ?? 1_000_000n, perUserBytes: 0n, gracePercent: 0, extraBytes: 0n, activeUsers: 1 }),
  } as unknown as TenantUsageRepository;
  const documents = {
    lockVersions: async () => void calls.push('lockVersions'),
    existsForFile: async () => options.recorded ?? false,
    publishNewVersion: async () => void calls.push('publish'),
  } as unknown as TicketDocumentRepository;
  const logger = { warn: (message: unknown) => warnings.push(message) } as unknown as JsonLogger;
  const quota = { sync: async (_tx: unknown, _tenant: string, _before: unknown, used: bigint) => void calls.push(`syncQuota:${used}`) } as unknown as QuotaWarningService;
  return { service: new SystemFileService(files, usage, documents, quota, logger), calls, warnings };
}

const tx = {} as TenantTransaction;

describe('SystemFileService.recordGeneratedDocument', () => {
  it('serializes the ticket, stores the file, counts its bytes and publishes the version, in that order', async () => {
    const { service, calls } = setup();
    expect(await service.recordGeneratedDocument(tx, TENANT, document)).toBe('recorded');
    expect(calls).toEqual(['lockVersions', 'insertFile', 'lockUsage', 'adjust:500', 'publish', 'syncQuota:500']);
  });

  it('recording the same file again changes nothing', async () => {
    const { service, calls } = setup({ recorded: true });
    expect(await service.recordGeneratedDocument(tx, TENANT, document)).toBe('already_recorded');
    expect(calls).toEqual(['lockVersions']);
  });

  it('never refuses for the quota: it counts the bytes and warns when the plan is exceeded', async () => {
    const { service, calls, warnings } = setup({ used: 900n, terms: { base: 1000n } });
    expect(await service.recordGeneratedDocument(tx, TENANT, document)).toBe('recorded');
    expect(calls).toContain('adjust:500');
    expect(warnings).toEqual([expect.objectContaining({ message: 'quota_exceeded_by_system_file', tenantId: TENANT, overByBytes: '400' })]);
  });

  it('is quiet while the plan has room', async () => {
    const { service, warnings } = setup();
    await service.recordGeneratedDocument(tx, TENANT, document);
    expect(warnings).toEqual([]);
  });
});
