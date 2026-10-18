import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/shared/api';
import { authErrorMessage, isExpiredStep, isOrganizationRefusal } from './auth-error-message';

const apiError = (status: number, code: string, extra: { retryAfterSeconds?: number; requestId?: string } = {}) => new ApiError({ status, code, message: code, ...extra });

describe('authErrorMessage', () => {
  it.each([
    ['wrong credentials', apiError(401, 'INVALID_CREDENTIALS'), 'credentials', { key: 'auth:errors.invalidCredentials' }],
    ['a long rate limit', apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 600 }), 'credentials', { key: 'auth:errors.rateLimited', values: { count: 10 } }],
    ['a rate limit of a few seconds', apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }), 'credentials', { key: 'auth:errors.rateLimitedShort' }],
    ['a rate limit without Retry-After', apiError(429, 'RATE_LIMITED'), 'credentials', { key: 'auth:errors.rateLimitedShort' }],
    ['a wrong app code', apiError(401, 'INVALID_MFA_CODE'), 'totp', { key: 'auth:errors.invalidTotp' }],
    ['a wrong backup code', apiError(401, 'INVALID_MFA_CODE'), 'backupCode', { key: 'auth:errors.invalidBackupCode' }],
    ['an expired challenge', apiError(401, 'UNAUTHENTICATED'), 'totp', { key: 'auth:notices.challengeExpired' }],
    ['an expired selection', apiError(401, 'UNAUTHENTICATED'), 'selection', { key: 'auth:notices.selectionExpired' }],
    ['a suspended organization', apiError(403, 'TENANT_SUSPENDED'), 'selection', { key: 'auth:errors.tenantSuspended' }],
    ['a pending deletion', apiError(403, 'TENANT_PENDING_DELETION'), 'selection', { key: 'auth:errors.tenantPendingDeletion' }],
    ['an organization in maintenance', apiError(503, 'MAINTENANCE'), 'selection', { key: 'auth:maintenance.title' }],
    ['a busy server', apiError(503, 'TEMPORARILY_UNAVAILABLE'), 'credentials', { key: 'auth:errors.busy' }],
    ['a rejected body', apiError(400, 'VALIDATION_FAILED'), 'credentials', { key: 'auth:errors.invalidRequest' }],
    ['an unknown error with its reference', apiError(500, 'INTERNAL_ERROR', { requestId: 'req-9' }), 'credentials', { key: 'common:errors.unexpectedWithReference', values: { requestId: 'req-9' } }],
    ['an unknown error without reference', apiError(500, 'INTERNAL_ERROR'), 'credentials', { key: 'common:errors.unexpected' }],
    ['no connection', new NetworkError(new TypeError()), 'credentials', { key: 'common:errors.network' }],
    ['a bug', new TypeError('x'), 'credentials', { key: 'common:errors.unexpected' }],
  ] as const)('maps %s', (_label, error, context, message) => {
    expect(authErrorMessage(error, context)).toEqual(message);
  });
});

describe('isOrganizationRefusal', () => {
  it.each([
    [apiError(403, 'TENANT_SUSPENDED'), true],
    [apiError(403, 'MFA_REQUIRED'), true],
    [apiError(503, 'MAINTENANCE'), true],
    [apiError(401, 'UNAUTHENTICATED'), false],
    [new NetworkError(null), false],
  ])('%o → %s', (error, expected) => {
    expect(isOrganizationRefusal(error)).toBe(expected);
  });
});

describe('isExpiredStep', () => {
  it('is only an UNAUTHENTICATED 401', () => {
    expect(isExpiredStep(apiError(401, 'UNAUTHENTICATED'))).toBe(true);
    expect(isExpiredStep(apiError(401, 'INVALID_MFA_CODE'))).toBe(false);
    expect(isExpiredStep(new Error('x'))).toBe(false);
  });
});
