import { UnauthenticatedError } from '@procesabpm/shared';
import { decodeProtectedHeader, decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../../config/app-config.js';
import type { Clock } from '../clock.js';
import { ACCESS_TOKEN_TTL_SECONDS, JwtTokenService, MFA_CHALLENGE_TTL_SECONDS, SELECTION_TOKEN_TTL_SECONDS } from './jwt-token-service.js';

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
    const { token, expiresIn } = await service.issueSelectionToken(claims.sub, { mfa: false });
    expect(expiresIn).toBe(SELECTION_TOKEN_TTL_SECONDS);
    await expect(service.verifySelectionToken(token)).resolves.toMatchObject({ userId: claims.sub });
    advance(2 * 60 + 10);
    await expect(service.verifySelectionToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('gives every selection token its own id and carries its issue and expiry instants', async () => {
    const { service } = setup();
    const first = await service.verifySelectionToken((await service.issueSelectionToken(claims.sub, { mfa: false })).token);
    const second = await service.verifySelectionToken((await service.issueSelectionToken(claims.sub, { mfa: false })).token);
    expect(first.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.jti).not.toBe(second.jti);
    expect(first.expiresAt.getTime() - first.issuedAt.getTime()).toBe(SELECTION_TOKEN_TTL_SECONDS * 1000);
  });

  it('carries the second-factor result in the selection token', async () => {
    const { service } = setup();
    expect(await service.verifySelectionToken((await service.issueSelectionToken(claims.sub, { mfa: true })).token)).toMatchObject({ mfa: true });
    expect(await service.verifySelectionToken((await service.issueSelectionToken(claims.sub, { mfa: false })).token)).toMatchObject({ mfa: false });
  });

  describe('MFA challenge', () => {
    it('lasts five minutes and carries its purpose and a single-use id', async () => {
      const { service, advance } = setup();
      const { token, expiresIn } = await service.issueMfaChallenge(claims.sub, 'VERIFY');
      expect(expiresIn).toBe(MFA_CHALLENGE_TTL_SECONDS);
      expect(await service.verifyMfaChallenge(token, 'VERIFY')).toMatchObject({ userId: claims.sub, purpose: 'VERIFY', jti: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      advance(5 * 60 + 10);
      await expect(service.verifyMfaChallenge(token, 'VERIFY')).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('is not accepted for the other purpose', async () => {
      const { service } = setup();
      const { token } = await service.issueMfaChallenge(claims.sub, 'ENROLL');
      await expect(service.verifyMfaChallenge(token, 'VERIFY')).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('is never a selection, access or platform token, nor the other way round', async () => {
      const { service } = setup();
      const challenge = await service.issueMfaChallenge(claims.sub, 'VERIFY');
      const selection = await service.issueSelectionToken(claims.sub, { mfa: true });
      const access = await service.issueAccessToken(claims);
      await expect(service.verifySelectionToken(challenge.token)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifyAccessToken(challenge.token)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifyMfaChallenge(selection.token, 'VERIFY')).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifyMfaChallenge(access.token, 'VERIFY')).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });

  it('never accepts a selection token as an access token, nor the other way round', async () => {
    const { service } = setup();
    const selection = await service.issueSelectionToken(claims.sub, { mfa: false });
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

  describe('support tokens', () => {
    const support = { ...claims, grant: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae' };

    it('carry the grant, last as long as asked and are verified on their own audience', async () => {
      const { service } = setup();
      const { token, expiresIn } = await service.issueSupportToken(support, 120);
      expect(expiresIn).toBe(120);
      const payload = decodeJwt(token);
      expect(payload.aud).toBe('procesabpm:support');
      expect(payload.exp! - payload.iat!).toBe(120);
      expect(await service.verifySupportToken(token)).toEqual(support);
    });

    it('are never accepted as access or platform tokens, nor are those accepted as support tokens', async () => {
      const { service } = setup();
      const { token: supportToken } = await service.issueSupportToken(support, 120);
      const { token: accessToken } = await service.issueAccessToken(claims);
      const { token: platformToken } = await service.issuePlatformToken({ sub: claims.sub, sid: claims.sid });
      await expect(service.verifyAccessToken(supportToken)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifyPlatformToken(supportToken)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifySupportToken(accessToken)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(service.verifySupportToken(platformToken)).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('expire and reject another signature or a missing grant', async () => {
      const { service, advance } = setup();
      const { token } = await service.issueSupportToken(support, 60);
      advance(70);
      await expect(service.verifySupportToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
      const other = setup('another-secret-with-at-least-32-bytes!!').service;
      await expect(service.verifySupportToken((await other.issueSupportToken(support, 60)).token)).rejects.toBeInstanceOf(UnauthenticatedError);
      const noGrant = await new SignJWT({ tid: claims.tid, sid: claims.sid })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuer('procesabpm')
        .setAudience('procesabpm:support')
        .setIssuedAt(Math.floor(new Date('2026-10-01T12:00:00Z').getTime() / 1000))
        .setExpirationTime(Math.floor(new Date('2026-10-01T13:00:00Z').getTime() / 1000))
        .sign(new TextEncoder().encode(SECRET));
      await expect(setup().service.verifySupportToken(noGrant)).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
