import { describe, expect, it } from 'vitest';
import { extractSqlState, mapDatabaseError } from './database-error.js';
import {
  DomainError,
  DuplicateError,
  ImmutableDataError,
  InvalidReferenceError,
  InvalidStateError,
  OverlapError,
  PermissionDeniedError,
} from './domain-error.js';

const pgError = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

describe('mapDatabaseError', () => {
  it.each([
    ['23001', ImmutableDataError, 'IMMUTABLE_DATA'],
    ['23514', InvalidStateError, 'INVALID_STATE'],
    ['23503', InvalidReferenceError, 'INVALID_REFERENCE'],
    ['23505', DuplicateError, 'DUPLICATE'],
    ['23P01', OverlapError, 'OVERLAP'],
    ['42501', PermissionDeniedError, 'PERMISSION_DENIED'],
  ])('maps SQLSTATE %s to a typed error', (sqlState, errorClass, code) => {
    const original = pgError(sqlState, 'rule violated');
    const mapped = mapDatabaseError(original);

    expect(mapped).toBeInstanceOf(errorClass);
    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped?.code).toBe(code);
    expect(mapped?.message).toBe('rule violated');
    expect(mapped?.cause).toBe(original);
  });

  it.each([
    ['an unknown SQLSTATE', pgError('40001')],
    ['an error without code', new Error('plain')],
    ['a non-error value', 'text'],
    ['null', null],
  ])('returns undefined for %s', (_label, error) => {
    expect(mapDatabaseError(error)).toBeUndefined();
  });
});

describe('extractSqlState', () => {
  it.each([
    ['direct code', pgError('23505'), '23505'],
    ['code inside cause', new Error('wrapper', { cause: pgError('23001') }), '23001'],
    ['code inside meta', Object.assign(new Error('prisma'), { code: 'P2010', meta: { code: '23514' } }), '23514'],
    ['non SQLSTATE code only', Object.assign(new Error('x'), { code: 'ECONNRESET' }), undefined],
  ])('reads %s', (_label, error, expected) => {
    expect(extractSqlState(error)).toBe(expected);
  });

  it('stops on deep cause chains', () => {
    let error: Error = pgError('23505');
    for (let i = 0; i < 10; i += 1) error = new Error('wrapper', { cause: error });
    expect(extractSqlState(error)).toBeUndefined();
  });
});
