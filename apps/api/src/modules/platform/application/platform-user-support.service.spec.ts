import { MfaNotEnabledError, type MfaResetRequest, NotFoundError, type PlatformUserResponse, RateLimitedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../../common/logging/request-context.js';
import type { PlatformTransaction, PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import type { RateLimiter, RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';
import type { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import type { MfaResetResult, PlatformUserRepository } from '../data/platform-user.repository.js';
import { PLATFORM_USER_SUPPORT_LIMITS } from '../domain/platform-user-support-policy.js';
import { PlatformUserSupportService } from './platform-user-support.service.js';

const ADMIN_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789a1';
const USER_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789a2';
const TENANT_ADMIN_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789a3';
const tx = {} as PlatformTransaction;
const USER: PlatformUserResponse = { id: USER_ID, firstName: 'Ana', lastName: 'Ruiz', status: 'ACTIVE', mfaEnabled: true, isPlatformAdmin: false, memberships: [] };
const REQUEST: MfaResetRequest = { reason: 'Lost the phone and the codes', verification: { method: 'VIDEO_CALL', reference: 'CASE-1' } };
const RESET: MfaResetResult = { resetAt: new Date('2026-10-03T15:00:00.123Z'), revokedSessions: 2 };

interface Options {
  readonly found?: PlatformUserResponse;
  /** `null`: the function answered no rows. */
  readonly reset?: MfaResetResult | null;
  readonly exists?: boolean;
  /** Keys whose limit is spent. */
  readonly limited?: readonly string[];
}

function setup({ found = USER, reset = RESET, exists = true, limited = [] }: Options = {}) {
  const users = { findByEmail: vi.fn().mockResolvedValue(found), resetMfa: vi.fn().mockResolvedValue(reset ?? undefined), exists: vi.fn().mockResolvedValue(exists) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const limiter = {
    hit: vi.fn((key: string, _rule: RateLimitRule) => Promise.resolve({ allowed: !limited.includes(key), retryAfterSeconds: limited.includes(key) ? 60 : 0 })),
  };
  const runner = { run: <T>(work: (scope: PlatformTransaction) => Promise<T>) => work(tx) };
  const service = new PlatformUserSupportService(
    runner as unknown as PlatformTransactionRunner,
    users as unknown as PlatformUserRepository,
    audit as unknown as PlatformAuditRepository,
    limiter as RateLimiter,
    { current: () => ({ requestId: 'r', ipAddress: '203.0.113.9' }) } as unknown as RequestContext,
  );
  return { service, users, audit, limiter };
}

describe('PlatformUserSupportService', () => {
  describe('lookup', () => {
    it('returns the account and audits its id, never the e-mail', async () => {
      const { service, audit, limiter } = setup();
      await expect(service.lookup(ADMIN_ID, 'ana@example.com')).resolves.toEqual(USER);
      expect(limiter.hit).toHaveBeenCalledWith(`platform-user-lookup:admin:${ADMIN_ID}`, PLATFORM_USER_SUPPORT_LIMITS.lookupsPerAdmin);
      expect(audit.record).toHaveBeenCalledWith(tx, { actorUserId: ADMIN_ID, action: 'user.looked_up', data: { userId: USER_ID } });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('ana@example.com');
    });

    it('audits a lookup that found nothing, then answers 404', async () => {
      const { service, users, audit } = setup();
      users.findByEmail.mockResolvedValue(undefined);
      await expect(service.lookup(ADMIN_ID, 'nobody@example.com')).rejects.toBeInstanceOf(NotFoundError);
      expect(audit.record).toHaveBeenCalledWith(tx, { actorUserId: ADMIN_ID, action: 'user.looked_up', data: { userId: null } });
    });

    it('refuses over the limit before touching the database', async () => {
      const { service, users } = setup({ limited: [`platform-user-lookup:admin:${ADMIN_ID}`] });
      await expect(service.lookup(ADMIN_ID, 'ana@example.com')).rejects.toBeInstanceOf(RateLimitedError);
      expect(users.findByEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetMfa', () => {
    it('passes the verification and the client IP to the database function and answers when and how many sessions', async () => {
      const { service, users } = setup();
      const request: MfaResetRequest = { ...REQUEST, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-2', tenantAdminUserId: TENANT_ADMIN_ID } };
      await expect(service.resetMfa(ADMIN_ID, USER_ID, request)).resolves.toEqual({ resetAt: '2026-10-03T15:00:00.123Z', revokedSessions: 2 });
      expect(users.resetMfa).toHaveBeenCalledWith(tx, {
        administratorId: ADMIN_ID,
        userId: USER_ID,
        reason: REQUEST.reason,
        method: 'TENANT_ADMIN_REQUEST',
        reference: 'CASE-2',
        tenantAdminUserId: TENANT_ADMIN_ID,
        ipAddress: '203.0.113.9',
      });
    });

    it('sends no requester for the other methods', async () => {
      const { service, users } = setup();
      await service.resetMfa(ADMIN_ID, USER_ID, REQUEST);
      expect(users.resetMfa).toHaveBeenCalledWith(tx, expect.objectContaining({ method: 'VIDEO_CALL', tenantAdminUserId: null }));
    });

    it('answers 409 MFA_NOT_ENABLED when the account exists without a second factor, 404 when it does not exist', async () => {
      await expect(setup({ reset: null, exists: true }).service.resetMfa(ADMIN_ID, USER_ID, REQUEST)).rejects.toBeInstanceOf(MfaNotEnabledError);
      await expect(setup({ reset: null, exists: false }).service.resetMfa(ADMIN_ID, USER_ID, REQUEST)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([`platform-mfa-reset:admin:${ADMIN_ID}`, `platform-mfa-reset:user:${USER_ID}`])('refuses when %s is over its limit, before the reset', async (key) => {
      const { service, users } = setup({ limited: [key] });
      await expect(service.resetMfa(ADMIN_ID, USER_ID, REQUEST)).rejects.toBeInstanceOf(RateLimitedError);
      expect(users.resetMfa).not.toHaveBeenCalled();
    });

    it('counts per administrator and per user with their own rules', async () => {
      const { service, limiter } = setup();
      await service.resetMfa(ADMIN_ID, USER_ID, REQUEST);
      expect(limiter.hit.mock.calls).toEqual([
        [`platform-mfa-reset:admin:${ADMIN_ID}`, PLATFORM_USER_SUPPORT_LIMITS.resetsPerAdmin],
        [`platform-mfa-reset:user:${USER_ID}`, PLATFORM_USER_SUPPORT_LIMITS.resetsPerUser],
      ]);
    });
  });
});
