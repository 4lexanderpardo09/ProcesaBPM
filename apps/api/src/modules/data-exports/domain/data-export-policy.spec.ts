import { ExportExpiredError, ExportInProgressError, ExportLimitReachedError, ExportNotReadyError, ExportTooLateError, InvalidStateError, NotFoundError, PermissionDeniedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { assertMayExport, assertMayRequest, DATA_EXPORT_POLICY, downloadRefusalFor, downloadUrlTtlSeconds, exportFileName } from './data-export-policy.js';

const owner: Principal = {
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: true,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null },
  tenantMode: 'DELETION_PENDING',
};
const HOUR = 3_600_000;
const now = new Date('2026-10-04T12:00:00Z');

describe('assertMayExport', () => {
  it.each([
    ['the owner', owner],
    ['a member of an active admin role', { ...owner, isOwner: false, roleIsAdmin: true }],
  ])('lets %s export an organization pending deletion', (_label, principal) => {
    expect(() => assertMayExport(principal)).not.toThrow();
  });

  it.each([
    ['a member without full access', { ...owner, isOwner: false }],
    ['a member of an inactive admin role', { ...owner, isOwner: false, roleIsAdmin: true, roleActive: false }],
    ['a support visit, whatever its flags say', { ...owner, support: { grantId: 'g1' } }],
  ])('refuses %s', (_label, principal) => {
    expect(() => assertMayExport(principal)).toThrow(PermissionDeniedError);
  });

  it('is only available during the deletion period (B11)', () => {
    expect(() => assertMayExport({ ...owner, tenantMode: 'ACTIVE' })).toThrow(InvalidStateError);
  });
});

describe('assertMayRequest', () => {
  const facts = { tenantStatus: 'PENDING_DELETION', purgeAfter: new Date(now.getTime() + 10 * 24 * HOUR), requests: 0, inFlight: 0, now };

  it('accepts a request well before the purge', () => {
    expect(() => assertMayRequest(facts)).not.toThrow();
    expect(() => assertMayRequest({ ...facts, purgeAfter: new Date(now.getTime() + DATA_EXPORT_POLICY.minTimeBeforePurgeMs), requests: 4 })).not.toThrow();
  });

  it('refuses outside the deletion period, too close to the purge, with one in flight and past the limit', () => {
    expect(() => assertMayRequest({ ...facts, tenantStatus: 'ACTIVE', purgeAfter: null })).toThrow(InvalidStateError);
    expect(() => assertMayRequest({ ...facts, purgeAfter: new Date(now.getTime() + 6 * HOUR - 1) })).toThrow(ExportTooLateError);
    expect(() => assertMayRequest({ ...facts, inFlight: 1, requests: 1 })).toThrow(ExportInProgressError);
    expect(() => assertMayRequest({ ...facts, requests: DATA_EXPORT_POLICY.maxRequestsPerTenant })).toThrow(ExportLimitReachedError);
  });
});

describe('downloads', () => {
  it('explain why there is nothing to download', () => {
    expect(downloadRefusalFor(undefined)).toBeInstanceOf(NotFoundError);
    expect(downloadRefusalFor({ status: 'EXPIRED' })).toBeInstanceOf(ExportExpiredError);
    expect(downloadRefusalFor({ status: 'READY' })).toBeInstanceOf(ExportExpiredError);
    for (const status of ['PENDING', 'RUNNING', 'FAILED'] as const) expect(downloadRefusalFor({ status })).toBeInstanceOf(ExportNotReadyError);
  });

  it('sign links for 5 minutes at most, never beyond the export itself', () => {
    expect(downloadUrlTtlSeconds(new Date(now.getTime() + 7 * 24 * HOUR), now)).toBe(300);
    expect(downloadUrlTtlSeconds(new Date(now.getTime() + 90_000), now)).toBe(90);
    expect(downloadUrlTtlSeconds(new Date(now.getTime() + 200), now)).toBe(1);
  });

  it('name the archive after the organization and the day it was built', () => {
    expect(exportFileName('acme', new Date('2026-10-04T23:59:00Z'))).toBe('acme-export-2026-10-04.zip');
  });
});
