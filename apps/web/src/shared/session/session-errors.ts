export type SignOutReason = 'userSignedOut' | 'expired' | 'mfaRequired' | 'signedOutElsewhere';

export interface MaintenanceDetails {
  readonly title: string;
  readonly body?: string | undefined;
  readonly endsAt: string | null;
}

export type SessionBlock =
  | { readonly kind: 'maintenance'; readonly details: MaintenanceDetails; readonly retryAfterSeconds?: number | undefined }
  | { readonly kind: 'tenantSuspended' }
  | { readonly kind: 'tenantPendingDeletion' };

export type RefreshFailure =
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'mfaRequired' }
  | { readonly kind: 'blocked'; readonly block: SessionBlock }
  | { readonly kind: 'network' }
  | { readonly kind: 'unavailable' };

export class RefreshFailedError extends Error {
  constructor(readonly failure: RefreshFailure) {
    super(`The session could not be renewed (${failure.kind})`);
    this.name = 'RefreshFailedError';
  }
}

/** The request was rejected because the session is over; the session manager already moved to signed out. */
export class SessionEndedError extends Error {
  constructor() {
    super('The session has ended');
    this.name = 'SessionEndedError';
  }
}

/** The answer belongs to an identity that is no longer the current one (another organization or person): it is dropped. */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed while the request was in flight');
    this.name = 'SessionChangedError';
  }
}
