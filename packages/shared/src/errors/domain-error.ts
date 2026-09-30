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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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
  constructor(message: string) {
    super(ERROR_CODES.invalidCondition, message);
  }
}
