import { UnauthenticatedError } from '@procesabpm/shared';
import { decodeProtectedHeader, decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../../config/app-config.js';
import type { Clock } from '../clock.js';
import { ACCESS_TOKEN_TTL_SECONDS, JwtTokenService, SELECTION_TOKEN_TTL_SECONDS } from './jwt-token-service.js';

const SECRET = 'unit-test-secret-with-at-least-32-bytes';
const claims = {
  sub: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  tid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac',
  sid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
};

function setup(secret = SECRET) {
  let now = new Date('2026-10-01T12:00:00Z');
  const clock: Clock = { now: () => now };
  const service = new JwtTokenService({ JWT_SECRET: secret } as ApiConfig, clock);
  return { service, advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)) };
}

describe('JwtTokenService', () => {
  it('issues HS256 access tokens with only sub, tid and sid', async () => {
    const { service } = setup();
    const { token, expiresIn } = await service.issueAccessToken(claims);
    expect(expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256' });
    const payload = decodeJwt(token);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid', 'sub', 'tid']);
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    expect(await service.verifyAccessToken(token)).toEqual(claims);
  });

  it('expires access tokens after 15 minutes', async () => {
    const { service, advance } = setup();
    const { token } = await service.issueAccessToken(claims);
    advance(15 * 60 - 1);
    await expect(service.verifyAccessToken(token)).resolves.toEqual(claims);
    advance(10);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('expires selection tokens after 2 minutes', async () => {
    const { service, advance } = setup();
    const { token, expiresIn } = await service.issueSelectionToken(claims.sub);
    expect(expiresIn).toBe(SELECTION_TOKEN_TTL_SECONDS);
    await expect(service.verifySelectionToken(token)).resolves.toBe(claims.sub);
    advance(2 * 60 + 10);
    await expect(service.verifySelectionToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('never accepts a selection token as an access token, nor the other way round', async () => {
    const { service } = setup();
    const selection = await service.issueSelectionToken(claims.sub);
    const access = await service.issueAccessToken(claims);
    await expect(service.verifyAccessToken(selection.token)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(service.verifySelectionToken(access.token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await setup('another-secret-that-is-also-32-bytes-long').service.issueAccessToken(claims);
    await expect(setup().service.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a tampered token', async () => {
    const { service } = setup();
    const { token } = await service.issueAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), tid: claims.sub })).toString('base64url');
    await expect(service.verifyAccessToken(`${header}.${forged}.${signature}`)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects the "none" algorithm', async () => {
    const { service } = setup();
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ ...claims, iss: 'procesabpm', aud: 'procesabpm:api', iat: 1, exp: 9_999_999_999 }),
    ).toString('base64url');
    await expect(service.verifyAccessToken(`${header}.${body}.`)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a correctly signed token whose claims are not ids', async () => {
    const { service } = setup();
    const token = await new SignJWT({ tid: 'acme', sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer('procesabpm')
      .setAudience('procesabpm:api')
      .setIssuedAt(Math.floor(Date.parse('2026-10-01T12:00:00Z') / 1000))
      .setExpirationTime(Math.floor(Date.parse('2026-10-01T12:10:00Z') / 1000))
      .sign(new TextEncoder().encode(SECRET));
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects %j', async (token) => {
    await expect(setup().service.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
