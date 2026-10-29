import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import { JsonLogger } from './json-logger.js';
import { RequestContext } from './request-context.js';

function setup(level: AppConfig['LOG_LEVEL'] = 'debug') {
  const lines: string[] = [];
  const tenantContext = new TenantContext();
  const requestContext = new RequestContext();
  const config = { LOG_LEVEL: level } as AppConfig;
  const logger = new JsonLogger(config, tenantContext, requestContext, (line) => lines.push(line));
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, tenantContext, requestContext, entries };
}

describe('JsonLogger', () => {
  it('writes one JSON object per line', () => {
    const { logger, entries } = setup();
    logger.log('hello', 'AppModule');
    const [entry] = entries();
    expect(entry).toMatchObject({ level: 'info', message: 'hello', context: 'AppModule' });
    expect(new Date(entry!.time as string).toISOString()).toBe(entry!.time);
  });

  it('adds tenant_id and request_id of the current async context', () => {
    const { logger, tenantContext, requestContext, entries } = setup();
    requestContext.run({ requestId: 'req-1' }, () =>
      tenantContext.run({ tenantId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, () => logger.log('inside')),
    );
    logger.log('outside');
    expect(entries()[0]).toMatchObject({ tenant_id: '11111111-1111-4111-8111-111111111111', request_id: 'req-1' });
    expect(entries()[1]).not.toHaveProperty('tenant_id');
    expect(entries()[1]).not.toHaveProperty('request_id');
  });

  it('merges structured fields', () => {
    const { logger, entries } = setup();
    logger.info('ticket created', { ticketId: 't-1' });
    expect(entries()[0]).toMatchObject({ message: 'ticket created', ticketId: 't-1' });
  });

  it.each([
    ['debug', 'debug', true],
    ['info', 'debug', false],
    ['info', 'warn', true],
    ['warn', 'info', false],
    ['error', 'warn', false],
    ['error', 'error', true],
  ] as const)('with LOG_LEVEL=%s, %s is written: %s', (configured, method, written) => {
    const { logger, entries } = setup(configured);
    logger[method]('message');
    expect(entries()).toHaveLength(written ? 1 : 0);
  });

  it('logs the stack of an Error', () => {
    const { logger, entries } = setup();
    logger.error(new Error('failed'), 'Filter');
    expect(entries()[0]).toMatchObject({ level: 'error', message: 'failed', context: 'Filter' });
    expect(entries()[0]!.stack).toContain('Error: failed');
  });

  it('maps verbose to debug and fatal to error', () => {
    const { logger, entries } = setup();
    logger.verbose('v');
    logger.fatal('f');
    expect(entries().map((entry) => entry.level)).toEqual(['debug', 'error']);
  });

  it('describes an error with its code and cause, so a worker failure never reads [object Object]', () => {
    const { logger, entries } = setup();
    const cause = Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' });
    logger.error(new Error('Could not record the outbox failure', { cause }), 'OutboxDispatcher');
    expect(entries()[0]).toMatchObject({
      level: 'error',
      message: 'Could not record the outbox failure',
      context: 'OutboxDispatcher',
      error: { name: 'Error', message: 'Could not record the outbox failure', cause: { message: 'Connection terminated unexpectedly', code: '57P01' } },
    });
    expect(entries()[0]!.stack).toContain('Could not record the outbox failure');
  });

  it('reads a value thrown that is not an Error', () => {
    const { logger, entries } = setup();
    logger.error(Object.create({ code: 'ECONNRESET' }) as object, 'OutboxPoller');
    logger.error(new (class Weird {})(), 'OutboxPoller');
    for (const entry of entries()) expect(JSON.stringify(entry)).not.toContain('[object Object]');
  });

  it('takes structured fields given as the message, with their own message, instead of printing [object Object]', () => {
    const { logger, entries } = setup();
    logger.warn({ message: 'Outbox event failed and will be retried', eventId: 'e-1', error: 'Error:ETIMEDOUT' }, 'OutboxDispatcher');
    expect(entries()[0]).toMatchObject({ level: 'warn', message: 'Outbox event failed and will be retried', context: 'OutboxDispatcher', eventId: 'e-1', error: 'Error:ETIMEDOUT' });
  });

  it('describes an error given after the message', () => {
    const { logger, entries } = setup();
    logger.error('Upload failed', Object.assign(new Error('Access Denied'), { code: 'AccessDenied' }), 'Storage');
    expect(entries()[0]).toMatchObject({ message: 'Upload failed', context: 'Storage', error: { message: 'Access Denied', code: 'AccessDenied' } });
  });
});
