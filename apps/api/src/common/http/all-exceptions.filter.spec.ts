import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import {
  InvalidCredentialsError,
  InvalidStateError,
  MfaNotImplementedError,
  MissingTenantContextError,
  RateLimitedError,
  ValidationFailedError,
} from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import { JsonLogger } from '../logging/json-logger.js';
import { RequestContext } from '../logging/request-context.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

const prismaError = (prismaCode: string, originalCode: string, message = 'relation "secret_table" violates something') =>
  Object.assign(new Error(message), {
    code: prismaCode,
    meta: { driverAdapterError: { cause: { originalCode, originalMessage: message } } },
  });

function respond(exception: unknown) {
  const lines: string[] = [];
  const requestContext = new RequestContext();
  const logger = new JsonLogger({ LOG_LEVEL: 'debug' } as AppConfig, new TenantContext(), requestContext, (line) =>
    lines.push(line),
  );
  const filter = new AllExceptionsFilter(logger, requestContext);
  const json = vi.fn();
  const status = vi.fn((_code: number) => ({ json }));
  const headers: Record<string, string> = {};
  const setHeader = (name: string, value: string) => (headers[name] = value);
  const host = { switchToHttp: () => ({ getResponse: () => ({ status, setHeader }) }) } as unknown as ArgumentsHost;
  requestContext.run({ requestId: 'req-9' }, () => filter.catch(exception, host));
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0], logged: lines, headers };
}

describe('AllExceptionsFilter', () => {
  it.each([
    ['unique violation (Prisma P2002)', prismaError('P2002', '23505'), 409, 'DUPLICATE'],
    ['trigger or check violation (23514)', prismaError('P2010', '23514'), 422, 'INVALID_STATE'],
    ['immutable data (23001)', prismaError('P2010', '23001'), 409, 'IMMUTABLE_DATA'],
    ['foreign key violation (23503)', prismaError('P2010', '23503'), 422, 'INVALID_REFERENCE'],
    ['overlap (23P01)', prismaError('P2010', '23P01'), 409, 'OVERLAP'],
    ['missing privilege (42501)', prismaError('P2010', '42501'), 403, 'PERMISSION_DENIED'],
    ['domain error', new InvalidStateError('ticket is closed'), 422, 'INVALID_STATE'],
  ])('answers a %s', (_label, exception, status, code) => {
    const response = respond(exception);
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: { code, message: expect.any(String), requestId: 'req-9' } });
    expect(response.logged).toHaveLength(0);
  });

  it.each([
    ['invalid credentials', new InvalidCredentialsError(), 401, 'INVALID_CREDENTIALS'],
    ['MFA not implemented', new MfaNotImplementedError(), 501, 'MFA_NOT_IMPLEMENTED'],
  ])('answers %s', (_label, exception, status, code) => {
    const response = respond(exception);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.logged).toHaveLength(0);
  });

  it('includes the validation issues', () => {
    const response = respond(new ValidationFailedError([{ path: 'email', message: 'Invalid email' }]));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: 'email', message: 'Invalid email' }] },
    });
  });

  it.each([
    ['a lock timeout', prismaError('P2010', '55P03')],
    ['a deadlock', prismaError('P2010', '40P01')],
    ['a transaction timeout', Object.assign(new Error('Unable to start a transaction in the given time'), { code: 'P2028' })],
  ])('answers %s with 503 and when to retry, never with a 4xx the client would not repeat', (_label, exception) => {
    const response = respond(exception);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(response.headers['Retry-After']).toBe('1');
    expect(JSON.stringify(response.body)).not.toContain('secret_table');
  });

  it('tells a rate-limited client when to retry', () => {
    const response = respond(new RateLimitedError(42));
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('42');
  });

  it('keeps database and domain messages out of the response', () => {
    for (const exception of [prismaError('P2010', '23514'), new InvalidStateError('internal detail')]) {
      expect(JSON.stringify(respond(exception).body)).not.toMatch(/secret_table|internal detail/);
    }
  });

  it('passes HTTP exceptions through', () => {
    const response = respond(new BadRequestException('bad input'));
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'HTTP_400', message: 'bad input' });
  });

  it.each([
    ['an unexpected error', new Error('db password is hunter2')],
    ['an unmapped database error', prismaError('P2010', '42601')],
    ['a missing tenant context', new MissingTenantContextError()],
    ['a non-error value', 'text'],
  ])('answers %s with a generic 500 and logs it', (_label, exception) => {
    const response = respond(exception);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'req-9' },
    });
    expect(response.logged).toHaveLength(1);
  });
});
