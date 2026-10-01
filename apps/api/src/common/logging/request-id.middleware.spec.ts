import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { RequestContext } from './request-context.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

function run(incoming: string | undefined) {
  const requestContext = new RequestContext();
  const headers: Record<string, string> = {};
  let seen: string | undefined;
  new RequestIdMiddleware(requestContext).use(
    { header: () => incoming } as unknown as Request,
    { setHeader: (name: string, value: string) => (headers[name] = value) } as unknown as Response,
    () => {
      seen = requestContext.current()?.requestId;
    },
  );
  return { seen, header: headers['x-request-id'] };
}

describe('RequestIdMiddleware', () => {
  it('keeps a well-formed id sent by the caller', () => {
    expect(run('abc-123.DEF_4')).toEqual({ seen: 'abc-123.DEF_4', header: 'abc-123.DEF_4' });
  });

  it.each([undefined, '', 'has space', 'a'.repeat(65), 'line\nbreak', '<script>'])('generates an id for %j', (incoming) => {
    const { seen, header } = run(incoming);
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(header).toBe(seen);
  });
});
