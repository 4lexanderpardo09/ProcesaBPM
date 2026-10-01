import {
  DomainError,
  DuplicateError,
  ImmutableDataError,
  InvalidReferenceError,
  InvalidStateError,
  OverlapError,
  PermissionDeniedError,
} from './domain-error.js';

const MAX_CAUSE_DEPTH = 8;

type DomainErrorFactory = (message: string, cause: unknown) => DomainError;

const FACTORY_BY_SQL_STATE: Readonly<Record<string, DomainErrorFactory>> = {
  '23001': (message, cause) => new ImmutableDataError(message, { cause }),
  '23514': (message, cause) => new InvalidStateError(message, { cause }),
  '23503': (message, cause) => new InvalidReferenceError(message, { cause }),
  '23505': (message, cause) => new DuplicateError(message, { cause }),
  '23P01': (message, cause) => new OverlapError(message, { cause }),
  '42501': (message, cause) => new PermissionDeniedError(message, { cause }),
};

interface ErrorShape {
  code?: unknown;
  originalCode?: unknown;
  cause?: unknown;
  meta?: { code?: unknown; driverAdapterError?: { cause?: ErrorShape } };
}

function candidateCodes(node: ErrorShape): unknown[] {
  const adapterCause = node.meta?.driverAdapterError?.cause;
  return [node.meta?.code, node.code, node.originalCode, adapterCause?.originalCode, adapterCause?.code];
}

/**
 * Walks an error and its `cause` chain and returns the first code that maps to a domain error.
 * Wrapper codes (Prisma `P2002`, `ECONNRESET`…) are skipped, and so are SQLSTATEs without a
 * mapping (such as `P0001`), so a wrapped rule violation is still found.
 */
export function extractSqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    const node = current as ErrorShape;
    const mapped = candidateCodes(node).find((code): code is string => typeof code === 'string' && Object.hasOwn(FACTORY_BY_SQL_STATE, code));
    if (mapped !== undefined) return mapped;
    current = node.cause;
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
