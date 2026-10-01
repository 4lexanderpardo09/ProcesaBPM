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
    ['P0001 (raise_exception) without mapping', pgError('P0001')],
    ['a code inherited from Object.prototype', pgError('toString')],
    ['an error without code', new Error('plain')],
    ['a non-error value', 'text'],
    ['null', null],
  ])('returns undefined for %s', (_label, error) => {
    expect(mapDatabaseError(error)).toBeUndefined();
  });
});

describe('mapDatabaseError with Prisma driver adapter errors', () => {
  const prismaError = (prismaCode: string, originalCode: string) =>
    Object.assign(new Error('prisma'), {
      code: prismaCode,
      meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode, kind: 'postgres' } } },
    });

  it.each([
    ['P2002', '23505', DuplicateError],
    ['P2010', '23514', InvalidStateError],
    ['P2010', '23503', InvalidReferenceError],
    ['P2010', '42501', PermissionDeniedError],
  ])('maps %s carrying SQLSTATE %s', (prismaCode, originalCode, errorClass) => {
    expect(mapDatabaseError(prismaError(prismaCode, originalCode))).toBeInstanceOf(errorClass);
  });

  it('does not map a driver error without a rule SQLSTATE', () => {
    expect(mapDatabaseError(prismaError('P2010', '42601'))).toBeUndefined();
  });
});

describe('extractSqlState', () => {
  it.each([
    ['direct code', pgError('23505'), '23505'],
    ['code inside cause', new Error('wrapper', { cause: pgError('23001') }), '23001'],
    ['code inside meta', Object.assign(new Error('prisma'), { code: 'P2010', meta: { code: '23514' } }), '23514'],
    ['a Prisma code wrapping a rule violation', Object.assign(new Error('prisma'), { code: 'P2002', cause: pgError('23505') }), '23505'],
    ['a code nested more than one level deep', new Error('a', { cause: new Error('b', { cause: new Error('c', { cause: pgError('23P01') }) }) }), '23P01'],
    ['the driver adapter original code', Object.assign(new Error('prisma'), { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '42501' } } } }), '42501'],
    ['a SQLSTATE without mapping', pgError('P0001'), undefined],
    ['non SQLSTATE code only', Object.assign(new Error('x'), { code: 'ECONNRESET' }), undefined],
  ])('reads %s', (_label, error, expected) => {
    expect(extractSqlState(error)).toBe(expected);
  });

  it('maps a Prisma error that wraps a duplicate', () => {
    const wrapped = Object.assign(new Error('unique'), { code: 'P2002', cause: pgError('23505') });
    expect(mapDatabaseError(wrapped)).toBeInstanceOf(DuplicateError);
  });

  it('stops on deep cause chains', () => {
    let error: Error = pgError('23505');
    for (let i = 0; i < 12; i += 1) error = new Error('wrapper', { cause: error });
    expect(extractSqlState(error)).toBeUndefined();
  });
});
