import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { RequestContext } from './request-context.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

function run(incoming: string | undefined, client: { ip?: string; userAgent?: string } = {}) {
  const requestContext = new RequestContext();
  const headers: Record<string, string> = {};
  let seen: string | undefined;
  let scope: ReturnType<RequestContext['current']>;
  new RequestIdMiddleware(requestContext).use(
    { header: (name: string) => (name === 'user-agent' ? client.userAgent : incoming), ip: client.ip } as unknown as Request,
    { setHeader: (name: string, value: string) => (headers[name] = value) } as unknown as Response,
    () => {
      scope = requestContext.current();
      seen = scope?.requestId;
    },
  );
  return { seen, header: headers['x-request-id'], scope };
}

describe('RequestIdMiddleware', () => {
  it('keeps a well-formed id sent by the caller', () => {
    expect(run('abc-123.DEF_4')).toMatchObject({ seen: 'abc-123.DEF_4', header: 'abc-123.DEF_4' });
  });

  it('records the client address and the user agent (cut to 512 characters) for the audit trail', () => {
    const { scope } = run('req-1', { ip: '203.0.113.9', userAgent: 'u'.repeat(600) });
    expect(scope).toEqual({ requestId: 'req-1', auditedActions: new Set(), ipAddress: '203.0.113.9', userAgent: 'u'.repeat(512) });
  });

  it.each([undefined, '', 'has space', 'a'.repeat(65), 'line\nbreak', '<script>'])('generates an id for %j', (incoming) => {
    const { seen, header } = run(incoming);
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(header).toBe(seen);
  });
});
