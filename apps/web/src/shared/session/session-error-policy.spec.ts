import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, UnexpectedResponseError } from '@/shared/api';
import { refreshFailureOf, sessionEffectOf } from './session-error-policy';

const apiError = (status: number, code: string, extra: { details?: unknown; retryAfterSeconds?: number } = {}) =>
  new ApiError({ status, code, message: code, ...extra });

const maintenance = apiError(503, 'MAINTENANCE', { details: { announcementId: 'a', title: 'Mantenimiento', body: 'Volvemos pronto', endsAt: null }, retryAfterSeconds: 120 });

describe('sessionEffectOf', () => {
  it.each([
    ['a 401', apiError(401, 'UNAUTHENTICATED'), { kind: 'ended', reason: 'expired' }],
    ['MFA required by the organization', apiError(403, 'MFA_REQUIRED'), { kind: 'ended', reason: 'mfaRequired' }],
    ['a suspended organization', apiError(403, 'TENANT_SUSPENDED'), { kind: 'blocked', block: { kind: 'tenantSuspended' } }],
    ['a pending deletion', apiError(403, 'TENANT_PENDING_DELETION'), { kind: 'deletionPending' }],
    [
      'maintenance',
      maintenance,
      { kind: 'blocked', block: { kind: 'maintenance', details: { title: 'Mantenimiento', body: 'Volvemos pronto', endsAt: null }, retryAfterSeconds: 120 } },
    ],
  ])('maps %s', (_label, error, effect) => {
    expect(sessionEffectOf(error)).toEqual(effect);
  });

  it.each([apiError(401, 'INVALID_CREDENTIALS'), apiError(401, 'INVALID_MFA_CODE'), apiError(403, 'PERMISSION_DENIED'), apiError(404, 'NOT_FOUND'), apiError(422, 'INVALID_STATE'), apiError(500, 'INTERNAL_ERROR')])(
    'leaves %s to the caller',
    (error) => {
      expect(sessionEffectOf(error)).toBeUndefined();
    },
  );

  it('still blocks a maintenance answer whose details are malformed', () => {
    expect(sessionEffectOf(apiError(503, 'MAINTENANCE', { details: 'x' }))).toMatchObject({ kind: 'blocked', block: { kind: 'maintenance', details: { title: '', endsAt: null } } });
  });
});

describe('refreshFailureOf', () => {
  it.each([
    ['a 401', apiError(401, 'UNAUTHENTICATED'), { kind: 'unauthenticated' }],
    ['MFA required', apiError(403, 'MFA_REQUIRED'), { kind: 'mfaRequired' }],
    ['a suspended organization', apiError(403, 'TENANT_SUSPENDED'), { kind: 'blocked', block: { kind: 'tenantSuspended' } }],
    ['a pending deletion', apiError(403, 'TENANT_PENDING_DELETION'), { kind: 'blocked', block: { kind: 'tenantPendingDeletion' } }],
    ['a 500', apiError(500, 'INTERNAL_ERROR'), { kind: 'unavailable' }],
    ['a rate limit', apiError(429, 'RATE_LIMITED'), { kind: 'unavailable' }],
    ['a network failure', new NetworkError(new TypeError()), { kind: 'network' }],
    ['an unexpected body', new UnexpectedResponseError(200, null), { kind: 'unavailable' }],
  ])('maps %s', (_label, error, failure) => {
    expect(refreshFailureOf(error)).toEqual(failure);
  });

  it('maps maintenance to a block', () => {
    expect(refreshFailureOf(maintenance)).toMatchObject({ kind: 'blocked', block: { kind: 'maintenance', retryAfterSeconds: 120 } });
  });
});
