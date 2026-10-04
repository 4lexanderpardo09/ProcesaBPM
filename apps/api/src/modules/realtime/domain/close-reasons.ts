import {
  type AckErrorCode,
  type ConnectErrorCode,
  MaintenanceError,
  mapDatabaseError,
  MfaRequiredError,
  RateLimitedError,
  type SessionEndReason,
  TemporarilyUnavailableError,
  TenantPendingDeletionError,
  TenantSuspendedError,
  UnauthenticatedError,
} from '@procesabpm/shared';

/** What to do with a live socket whose re-verification failed. */
export type VerificationFailure =
  | { readonly kind: 'reauth' } // the session is not accepted any more: the client has a short grace to send a new token
  | { readonly kind: 'end'; readonly reason: SessionEndReason }
  | { readonly kind: 'skip' }; // the database could not answer now: send nothing this time, keep the socket

/** Why a refreshed token was refused: the ack code and, unless the failure is transient, how the socket ends. */
export interface RefreshFailure {
  readonly code: AckErrorCode;
  readonly end: SessionEndReason | undefined;
}

/** The database (or the limiter in front of it) could not serve the check in time. Nothing is known about the session. */
export function isTransient(error: unknown): boolean {
  return error instanceof TemporarilyUnavailableError || mapDatabaseError(error) instanceof TemporarilyUnavailableError;
}

const isTenantClosed = (error: unknown) => error instanceof TenantSuspendedError || error instanceof TenantPendingDeletionError;

/** Why a handshake is refused (`connect_error` data). An unexpected error is an authentication failure: fail closed. */
export function connectErrorCodeOf(error: unknown): ConnectErrorCode {
  if (error instanceof RateLimitedError) return 'RATE_LIMITED';
  if (error instanceof MfaRequiredError) return 'MFA_REQUIRED';
  if (isTenantClosed(error)) return 'TENANT_SUSPENDED';
  if (error instanceof MaintenanceError) return 'MAINTENANCE';
  if (isTransient(error)) return 'TEMPORARILY_UNAVAILABLE';
  return 'UNAUTHENTICATED';
}

export function verificationFailureOf(error: unknown): VerificationFailure {
  if (error instanceof UnauthenticatedError) return { kind: 'reauth' };
  if (error instanceof MfaRequiredError) return { kind: 'end', reason: 'MFA_REQUIRED' };
  if (isTenantClosed(error)) return { kind: 'end', reason: 'TENANT_SUSPENDED' };
  if (error instanceof MaintenanceError) return { kind: 'end', reason: 'MAINTENANCE' };
  return { kind: 'skip' };
}

export function refreshFailureOf(error: unknown): RefreshFailure {
  if (error instanceof MfaRequiredError) return { code: 'MFA_REQUIRED', end: 'MFA_REQUIRED' };
  if (isTenantClosed(error)) return { code: 'TENANT_SUSPENDED', end: 'TENANT_SUSPENDED' };
  if (error instanceof MaintenanceError) return { code: 'MAINTENANCE', end: 'MAINTENANCE' };
  if (isTransient(error)) return { code: 'TEMPORARILY_UNAVAILABLE', end: undefined };
  return { code: 'UNAUTHENTICATED', end: 'SESSION_ENDED' };
}
