import { MaintenanceError, MfaRequiredError, NotFoundError, RateLimitedError, TemporarilyUnavailableError, TenantPendingDeletionError, TenantSuspendedError, UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { connectErrorCodeOf, isTransient, refreshFailureOf, verificationFailureOf } from './close-reasons.js';

const maintenance = new MaintenanceError({ announcementId: 'a1', title: 'Window', body: 'x', endsAt: null }, undefined);
const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });

describe('close reasons', () => {
  it('recognises transient database failures', () => {
    expect(isTransient(new TemporarilyUnavailableError(1))).toBe(true);
    expect(isTransient(lockTimeout)).toBe(true);
    expect(isTransient(new UnauthenticatedError())).toBe(false);
    expect(isTransient(new Error('boom'))).toBe(false);
  });

  it.each<[string, unknown, string]>([
    ['unauthenticated', new UnauthenticatedError(), 'UNAUTHENTICATED'],
    ['MFA required', new MfaRequiredError(), 'MFA_REQUIRED'],
    ['suspended', new TenantSuspendedError(), 'TENANT_SUSPENDED'],
    ['pending deletion', new TenantPendingDeletionError(), 'TENANT_SUSPENDED'],
    ['maintenance', maintenance, 'MAINTENANCE'],
    ['rate limited', new RateLimitedError(30), 'RATE_LIMITED'],
    ['transient', new TemporarilyUnavailableError(1), 'TEMPORARILY_UNAVAILABLE'],
    ['unexpected (fails closed)', new NotFoundError(), 'UNAUTHENTICATED'],
  ])('a handshake that fails as %s answers its code', (_name, error, code) => {
    expect(connectErrorCodeOf(error)).toBe(code);
  });

  it('a live socket whose session is refused gets a grace to refresh; policy failures end it; transient ones skip', () => {
    expect(verificationFailureOf(new UnauthenticatedError())).toEqual({ kind: 'reauth' });
    expect(verificationFailureOf(new MfaRequiredError())).toEqual({ kind: 'end', reason: 'MFA_REQUIRED' });
    expect(verificationFailureOf(new TenantSuspendedError())).toEqual({ kind: 'end', reason: 'TENANT_SUSPENDED' });
    expect(verificationFailureOf(new TenantPendingDeletionError())).toEqual({ kind: 'end', reason: 'TENANT_SUSPENDED' });
    expect(verificationFailureOf(maintenance)).toEqual({ kind: 'end', reason: 'MAINTENANCE' });
    expect(verificationFailureOf(lockTimeout)).toEqual({ kind: 'skip' });
  });

  it('a refused refresh ends the socket unless the failure is transient', () => {
    expect(refreshFailureOf(new UnauthenticatedError())).toEqual({ code: 'UNAUTHENTICATED', end: 'SESSION_ENDED' });
    expect(refreshFailureOf(new MfaRequiredError())).toEqual({ code: 'MFA_REQUIRED', end: 'MFA_REQUIRED' });
    expect(refreshFailureOf(new TenantSuspendedError())).toEqual({ code: 'TENANT_SUSPENDED', end: 'TENANT_SUSPENDED' });
    expect(refreshFailureOf(maintenance)).toEqual({ code: 'MAINTENANCE', end: 'MAINTENANCE' });
    expect(refreshFailureOf(new TemporarilyUnavailableError(1))).toEqual({ code: 'TEMPORARILY_UNAVAILABLE', end: undefined });
    expect(refreshFailureOf(new Error('boom'))).toEqual({ code: 'UNAUTHENTICATED', end: 'SESSION_ENDED' });
  });
});
