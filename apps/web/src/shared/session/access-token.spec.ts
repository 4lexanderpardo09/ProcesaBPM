import { describe, expect, it } from 'vitest';
import { UnexpectedResponseError } from '@/shared/api';
import { makeJwt } from '@/test/jwt';
import { decodeIdentity, sameIdentity, toAccessToken } from './access-token';

describe('decodeIdentity', () => {
  it('reads the user, organization and session claims', () => {
    expect(decodeIdentity(makeJwt({ sub: 'u', tid: 't', sid: 's' }))).toEqual({ userId: 'u', tenantId: 't', sessionId: 's' });
  });

  it('reads payloads with non-ASCII characters and base64url padding', () => {
    expect(decodeIdentity(makeJwt({ sub: 'ñandú-é', tid: 't', sid: 's' }))?.userId).toBe('ñandú-é');
  });

  it.each(['', 'not-a-jwt', 'a.%%%.c', `a.${btoa('{"sub":"u"}')}.c`, `a.${btoa('not json')}.c`])('rejects %j', (value) => {
    expect(decodeIdentity(value)).toBeUndefined();
  });
});

describe('toAccessToken', () => {
  it('computes the expiry from the local clock and the lifetime it was given', () => {
    const token = toAccessToken({ accessToken: makeJwt(), tokenType: 'Bearer', expiresIn: 900 }, 1_000);
    expect(token).toMatchObject({ receivedAt: 1_000, expiresAt: 901_000, identity: { userId: 'user-1', tenantId: 'tenant-1' } });
  });

  it('rejects a token without the session claims', () => {
    expect(() => toAccessToken({ accessToken: 'x.y.z', tokenType: 'Bearer', expiresIn: 900 }, 0)).toThrow(UnexpectedResponseError);
  });
});

describe('sameIdentity', () => {
  const identity = { userId: 'u', tenantId: 't', sessionId: 's1' };

  it('ignores the session id, which changes on every refresh', () => {
    expect(sameIdentity(identity, { ...identity, sessionId: 's2' })).toBe(true);
  });

  it('tells apart another organization or person', () => {
    expect(sameIdentity(identity, { ...identity, tenantId: 'other' })).toBe(false);
    expect(sameIdentity(identity, { ...identity, userId: 'other' })).toBe(false);
    expect(sameIdentity(identity, undefined)).toBe(false);
  });
});
