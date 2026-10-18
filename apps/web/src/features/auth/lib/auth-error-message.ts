import { ERROR_CODES } from '@procesabpm/shared';
import type { ParseKeys } from 'i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';

export type AuthMessageKey = ParseKeys<['auth', 'common']>;

export interface AuthMessage {
  readonly key: AuthMessageKey;
  readonly values?: Readonly<Record<string, string | number>>;
}

/** Which step failed: the same code means different things on each one. */
export type AuthErrorContext = 'credentials' | 'totp' | 'backupCode' | 'enrollment' | 'selection';

const SHORT_WAIT_SECONDS = 60;

/** The Spanish message for a failed sign-in step. The API `message` is never shown: only i18n keys and the request id. */
export function authErrorMessage(error: unknown, context: AuthErrorContext): AuthMessage {
  const specific = error instanceof ApiError ? messageForCode(error, context) : undefined;
  if (specific !== undefined) return specific;
  const generic = genericErrorMessage(error);
  return 'values' in generic ? { key: `common:${generic.key}`, values: generic.values } : { key: `common:${generic.key}` };
}

function messageForCode(error: ApiError, context: AuthErrorContext): AuthMessage | undefined {
  switch (error.code) {
    case ERROR_CODES.invalidCredentials:
      return { key: 'auth:errors.invalidCredentials' };
    case ERROR_CODES.rateLimited:
      return rateLimited(error.retryAfterSeconds);
    case ERROR_CODES.invalidMfaCode:
      return { key: context === 'backupCode' ? 'auth:errors.invalidBackupCode' : 'auth:errors.invalidTotp' };
    case ERROR_CODES.unauthenticated:
      return { key: context === 'selection' ? 'auth:notices.selectionExpired' : 'auth:notices.challengeExpired' };
    case ERROR_CODES.tenantSuspended:
      return { key: 'auth:errors.tenantSuspended' };
    case ERROR_CODES.tenantPendingDeletion:
      return { key: 'auth:errors.tenantPendingDeletion' };
    case ERROR_CODES.maintenance:
      return { key: 'auth:maintenance.title' };
    case ERROR_CODES.temporarilyUnavailable:
      return { key: 'auth:errors.busy' };
    case ERROR_CODES.validationFailed:
      return { key: 'auth:errors.invalidRequest' };
    default:
      return undefined;
  }
}

function rateLimited(retryAfterSeconds: number | undefined): AuthMessage {
  if (retryAfterSeconds === undefined || retryAfterSeconds <= SHORT_WAIT_SECONDS) return { key: 'auth:errors.rateLimitedShort' };
  return { key: 'auth:errors.rateLimited', values: { count: Math.ceil(retryAfterSeconds / 60) } };
}

/** The selection token survives a refused organization (403/503): the person can pick another one. */
export function isOrganizationRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 403 || error.code === ERROR_CODES.maintenance);
}

/** The challenge or selection token expired or was already used: the sign-in starts over. */
export function isExpiredStep(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === ERROR_CODES.unauthenticated;
}
