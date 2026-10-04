import { MfaRequiredError, TenantPendingDeletionError, TenantSuspendedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../../infrastructure/clock.js';
import type { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { LoginBlockRegistry } from '../../announcements/application/login-block-registry.js';
import type { TenantAccess, TenantAccessRepository } from '../data/tenant-access.repository.js';
import { type AccessRequest, TenantAccessService } from './tenant-access.service.js';

const member = { roleId: 'r1', roleActive: true, roleIsAdmin: false, permissionsVersion: 1, isOwner: false, departmentId: null, siteId: null, positionId: null };

function serviceFor(access: Partial<TenantAccess> & { membership: TenantAccess['membership'] }): TenantAccessService {
  const full: TenantAccess = { userStatus: 'ACTIVE', membershipStatus: 'ACTIVE', tenantStatus: 'ACTIVE', tenantMfaRequired: false, ...access };
  return new TenantAccessService(
    { run: <T>(_scope: unknown, work: () => T) => work() } as unknown as TenantContext,
    { withTenantTransaction: <T>(work: (tx: unknown) => Promise<T>) => work({}) } as unknown as TenantTransactionRunner,
    { findAccess: () => Promise.resolve(full), findSession: () => Promise.resolve(undefined) } as unknown as TenantAccessRepository,
    { now: () => new Date('2026-10-04T12:00:00Z') } as Clock,
    { blockFor: () => Promise.resolve(undefined) } as unknown as LoginBlockRegistry,
  );
}

const request = (allowDeletionPending: boolean): AccessRequest => ({ userId: 'u1', tenantId: 't1', mfaVerified: true, allowDeletionPending });

describe('TenantAccessService: organizations pending deletion', () => {
  it('an active organization is ACTIVE for everyone', async () => {
    await expect(serviceFor({ membership: member }).verify(request(false))).resolves.toMatchObject({ tenantMode: 'ACTIVE' });
  });

  it.each([
    ['the owner', { ...member, isOwner: true }],
    ['a member of an active admin role', { ...member, roleIsAdmin: true }],
    ['the owner whose role is inactive', { ...member, isOwner: true, roleActive: false }],
  ])('lets %s in, in DELETION_PENDING mode, when the caller allows it', async (_label, membership) => {
    const service = serviceFor({ membership, tenantStatus: 'PENDING_DELETION' });
    await expect(service.verify(request(true))).resolves.toMatchObject({ tenantMode: 'DELETION_PENDING' });
    await expect(service.verify(request(false))).rejects.toBeInstanceOf(TenantPendingDeletionError);
  });

  it.each([
    ['a member without full access', member],
    ['a member of an inactive admin role', { ...member, roleIsAdmin: true, roleActive: false }],
  ])('refuses %s even when the caller allows it', async (_label, membership) => {
    await expect(serviceFor({ membership, tenantStatus: 'PENDING_DELETION' }).verify(request(true))).rejects.toBeInstanceOf(TenantPendingDeletionError);
  });

  it('keeps every other closed state closed, whatever the caller allows', async () => {
    for (const tenantStatus of ['SUSPENDED', 'CANCELLED', 'PURGED'] as const) {
      await expect(serviceFor({ membership: { ...member, isOwner: true }, tenantStatus }).verify(request(true))).rejects.toBeInstanceOf(TenantSuspendedError);
    }
  });

  it('still applies the two-step verification policy in DELETION_PENDING mode', async () => {
    const service = serviceFor({ membership: { ...member, isOwner: true }, tenantStatus: 'PENDING_DELETION', tenantMfaRequired: true });
    await expect(service.verify({ ...request(true), mfaVerified: false })).rejects.toBeInstanceOf(MfaRequiredError);
  });
});
