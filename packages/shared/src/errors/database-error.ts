import {
  DomainError,
  DuplicateError,
  ImmutableDataError,
  InvalidReferenceError,
  InvalidStateError,
  OverlapError,
  PermissionDeniedError,
} from './domain-error.js';

const SQL_STATE_PATTERN = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 5;

type DomainErrorFactory = (message: string, cause: unknown) => DomainError;

const FACTORY_BY_SQL_STATE: Readonly<Record<string, DomainErrorFactory>> = {
  '23001': (message, cause) => new ImmutableDataError(message, { cause }),
  '23514': (message, cause) => new InvalidStateError(message, { cause }),
  '23503': (message, cause) => new InvalidReferenceError(message, { cause }),
  '23505': (message, cause) => new DuplicateError(message, { cause }),
  '23P01': (message, cause) => new OverlapError(message, { cause }),
  '42501': (message, cause) => new PermissionDeniedError(message, { cause }),
};

function readSqlState(candidate: unknown): string | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const { code, meta } = candidate as { code?: unknown; meta?: { code?: unknown } };
  for (const value of [meta?.code, code]) {
    if (typeof value === 'string' && SQL_STATE_PATTERN.test(value)) return value;
  }
  return undefined;
}

/** Finds the PostgreSQL SQLSTATE in an error or in its `cause` chain. */
export function extractSqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const sqlState = readSqlState(current);
    if (sqlState !== undefined) return sqlState;
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function domainErrorFromSqlState(sqlState: string, message: string, cause?: unknown): DomainError | undefined {
  return FACTORY_BY_SQL_STATE[sqlState]?.(message, cause);
}

/**
 * Translates a database error raised by a business rule into a typed domain error.
 * Returns `undefined` when the error is not one of the codes documented in
 * docs/base-de-datos.md §7, so the caller can treat it as an unexpected failure.
 */
export function mapDatabaseError(error: unknown): DomainError | undefined {
  const sqlState = extractSqlState(error);
  if (sqlState === undefined) return undefined;
  const message = error instanceof Error ? error.message : 'Database rule violated';
  return domainErrorFromSqlState(sqlState, message, error);
}
