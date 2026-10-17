import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/shared/api';
import { createFakeTransport } from '@/test/fake-transport';
import { makeJwt } from '@/test/jwt';
import { type AccessToken, accessTokenOf } from './access-token';
import { type AccessTokenProvider, createAuthorizedHttpClient } from './authorized-http-client';
import { SessionChangedError, SessionEndedError } from './session-errors';

const token = (sid: string, tid = 'tenant-1'): AccessToken => accessTokenOf(makeJwt({ tid, sid }), 0, Number.MAX_SAFE_INTEGER) ?? expect.fail();
const unauthorized = () => new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'x' });
const bearerOf = (options: { headers?: Readonly<Record<string, string>> }) => options.headers?.Authorization;
const tagsSchema = z.array(z.string());

function setUp(handler: (options: { headers?: Readonly<Record<string, string>> }) => unknown, { signedIn = true } = {}) {
  let current: AccessToken | undefined = signedIn ? token('s1') : undefined;
  const tokens: AccessTokenProvider = {
    current: () => current,
    renew: vi.fn(async () => {
      current = token('s2');
      return current;
    }),
  };
  const sink = { report: vi.fn() };
  const fake = createFakeTransport({ '/tags': handler });
  const client = createAuthorizedHttpClient(fake.transport, tokens, sink);
  return { client, tokens, sink, fake, setCurrent: (next: AccessToken | undefined) => (current = next) };
}

describe('createAuthorizedHttpClient', () => {
  it('sends the current token as a bearer and keeps the other headers', async () => {
    const { client, fake } = setUp(() => ['a']);
    await expect(client.request('/tags', { schema: tagsSchema, headers: { 'X-Test': '1' } })).resolves.toEqual(['a']);
    expect(fake.calls[0]?.options.headers).toEqual({ 'X-Test': '1', Authorization: `Bearer ${token('s1').value}` });
  });

  it('gets a token first when there is none yet', async () => {
    const { client, tokens, fake } = setUp(() => [], { signedIn: false });
    await client.request('/tags', { schema: tagsSchema });
    expect(tokens.renew).toHaveBeenCalledWith(undefined);
    expect(bearerOf(fake.calls[0]?.options ?? {})).toBe(`Bearer ${token('s2').value}`);
  });

  it('renews the rejected token once and retries once after a 401', async () => {
    const { client, tokens, fake } = setUp((options) => {
      if (bearerOf(options) === `Bearer ${token('s1').value}`) throw unauthorized();
      return ['ok'];
    });

    await expect(client.request('/tags', { schema: tagsSchema })).resolves.toEqual(['ok']);
    expect(tokens.renew).toHaveBeenCalledWith(token('s1').value);
    expect(fake.calls).toHaveLength(2);
  });

  it('ends the session when the renewed token is refused too', async () => {
    const { client, sink, fake } = setUp(() => {
      throw unauthorized();
    });

    await expect(client.request('/tags')).rejects.toBeInstanceOf(SessionEndedError);
    expect(fake.calls).toHaveLength(2);
    expect(sink.report).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('reports any other API error to the session and rethrows it', async () => {
    const forbidden = new ApiError({ status: 403, code: 'TENANT_SUSPENDED', message: 'x' });
    const { client, sink, tokens } = setUp(() => {
      throw forbidden;
    });

    await expect(client.request('/tags')).rejects.toBe(forbidden);
    expect(sink.report).toHaveBeenCalledWith(forbidden);
    expect(tokens.renew).not.toHaveBeenCalled();
  });

  it('drops an answer that arrives after the organization changed', async () => {
    const { client, setCurrent } = setUp(() => {
      setCurrent(token('s9', 'tenant-2'));
      return ['from tenant-1'];
    });
    await expect(client.request('/tags', { schema: tagsSchema })).rejects.toBeInstanceOf(SessionChangedError);
  });

  it('keeps an answer when only the session id changed (a refresh in between)', async () => {
    const { client, setCurrent } = setUp(() => {
      setCurrent(token('s9'));
      return ['same tenant'];
    });
    await expect(client.request('/tags', { schema: tagsSchema })).resolves.toEqual(['same tenant']);
  });

  it('lets non-API errors through untouched', async () => {
    const boom = new TypeError('boom');
    const { client, sink } = setUp(() => {
      throw boom;
    });
    await expect(client.request('/tags')).rejects.toBe(boom);
    expect(sink.report).not.toHaveBeenCalled();
  });
});
