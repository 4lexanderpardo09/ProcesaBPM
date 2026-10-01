export const ERROR_CODES = {
  immutableData: 'IMMUTABLE_DATA',
  invalidState: 'INVALID_STATE',
  invalidReference: 'INVALID_REFERENCE',
  duplicate: 'DUPLICATE',
  overlap: 'OVERLAP',
  permissionDenied: 'PERMISSION_DENIED',
  invalidCalendar: 'INVALID_CALENDAR',
  invalidDuration: 'INVALID_DURATION',
  invalidCondition: 'INVALID_CONDITION',
  missingTenantContext: 'MISSING_TENANT_CONTEXT',
  tenantContextMismatch: 'TENANT_CONTEXT_MISMATCH',
  invalidTenantContext: 'INVALID_TENANT_CONTEXT',
  unauthenticated: 'UNAUTHENTICATED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  invalidToken: 'INVALID_TOKEN',
  mfaNotImplemented: 'MFA_NOT_IMPLEMENTED',
  rateLimited: 'RATE_LIMITED',
  validationFailed: 'VALIDATION_FAILED',
  tenantSuspended: 'TENANT_SUSPENDED',
  missingCatalogPermission: 'MISSING_CATALOG_PERMISSION',
  platformAccessDenied: 'PLATFORM_ACCESS_DENIED',
  tenantSlugTaken: 'TENANT_SLUG_TAKEN',
  tenantNotFound: 'TENANT_NOT_FOUND',
  notFound: 'NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface DomainErrorOptions {
  readonly cause?: unknown;
  /** Safe to show to the client (e.g. which fields failed validation); never put internals here. */
  readonly details?: unknown;
}

export class DomainError extends Error {
  readonly details: unknown;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.details = options?.details;
    this.name = new.target.name;
  }
}

export class ImmutableDataError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.immutableData, message, options);
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidState, message, options);
  }
}

export class InvalidReferenceError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidReference, message, options);
  }
}

export class DuplicateError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.duplicate, message, options);
  }
}

export class OverlapError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.overlap, message, options);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.permissionDenied, message, options);
  }
}

export class InvalidCalendarError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.invalidCalendar, message);
  }
}

export class InvalidDurationError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.invalidDuration, message);
  }
}

export class InvalidConditionError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(ERROR_CODES.invalidCondition, message, options);
  }
}

export class MissingTenantContextError extends DomainError {
  constructor() {
    super(ERROR_CODES.missingTenantContext, 'A tenant context is required to query tenant data');
  }
}

export class TenantContextMismatchError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantContextMismatch, 'The database did not confirm the requested tenant context');
  }
}

export class InvalidTenantContextError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidTenantContext, 'The tenant context needs a tenantId and a userId that are UUIDs');
  }
}

/** Authentication failed or is missing: the reason is never disclosed (expired, revoked, malformed…). */
export class UnauthenticatedError extends DomainError {
  constructor() {
    super(ERROR_CODES.unauthenticated, 'Authentication is required');
  }
}

/** Wrong password, unknown e-mail, locked or disabled account: always the same error. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidCredentials, 'Invalid credentials');
  }
}

export class InvalidTokenError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidToken, 'The token is invalid or has expired', options);
  }
}

export class MfaNotImplementedError extends DomainError {
  constructor() {
    super(ERROR_CODES.mfaNotImplemented, 'Multi-factor authentication is not available yet');
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super(ERROR_CODES.rateLimited, 'Too many requests');
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationFailedError extends DomainError {
  constructor(issues: readonly ValidationIssue[]) {
    super(ERROR_CODES.validationFailed, 'The request is not valid', { details: { issues } });
  }
}

export class TenantSuspendedError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantSuspended, 'The organization is suspended');
  }
}

/** A role template names a permission that is not in the catalog: a deployment problem, not the caller's. */
export class MissingCatalogPermissionError extends DomainError {
  constructor(readonly missing: readonly string[]) {
    super(ERROR_CODES.missingCatalogPermission, `The permission catalog lacks: ${missing.join(', ')}`);
  }
}

/** The user is not (or is no longer) a platform administrator. */
export class PlatformAccessDeniedError extends DomainError {
  constructor() {
    super(ERROR_CODES.platformAccessDenied, 'Platform access is not allowed');
  }
}

export class TenantSlugTakenError extends DomainError {
  constructor(readonly slug: string) {
    super(ERROR_CODES.tenantSlugTaken, `The slug ${slug} is already taken`);
  }
}

export class TenantNotFoundError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantNotFound, 'The tenant does not exist');
  }
}

/** The record does not exist or belongs to another tenant: both answer the same, so existence is never confirmed. */
export class NotFoundError extends DomainError {
  constructor() {
    super(ERROR_CODES.notFound, 'The resource does not exist');
  }
}
