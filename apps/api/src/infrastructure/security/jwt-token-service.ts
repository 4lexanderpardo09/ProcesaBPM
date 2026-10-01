import { Inject, Injectable } from '@nestjs/common';
import {
  type AccessTokenClaims,
  accessTokenClaimsSchema,
  type PlatformTokenClaims,
  platformTokenClaimsSchema,
  UnauthenticatedError,
  uuidSchema,
} from '@procesabpm/shared';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { Clock } from '../clock.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SELECTION_TOKEN_TTL_SECONDS = 2 * 60;
/** A platform session is short and never renewed: after it, the administrator logs in again. */
export const PLATFORM_TOKEN_TTL_SECONDS = 15 * 60;

const ISSUER = 'procesabpm';
const ACCESS_AUDIENCE = 'procesabpm:api';
const SELECTION_AUDIENCE = 'procesabpm:tenant-selection';
const PLATFORM_AUDIENCE = 'procesabpm:platform';
const ALGORITHM = 'HS256';
const CLOCK_TOLERANCE_SECONDS = 5;

export interface IssuedToken {
  readonly token: string;
  readonly expiresIn: number;
}

const selectionClaimsSchema = z.object({ sub: uuidSchema });

/**
 * Signs and verifies the two short-lived JWTs. They use different audiences, so a selection
 * token is never accepted as an access token or the other way round. Claims carry ids only.
 */
@Injectable()
export class JwtTokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedToken> {
    return this.sign({ tid: claims.tid, sid: claims.sid }, claims.sub, ACCESS_AUDIENCE, ACCESS_TOKEN_TTL_SECONDS);
  }

  issuePlatformToken(claims: PlatformTokenClaims): Promise<IssuedToken> {
    return this.sign({ sid: claims.sid }, claims.sub, PLATFORM_AUDIENCE, PLATFORM_TOKEN_TTL_SECONDS);
  }

  issueSelectionToken(userId: string): Promise<IssuedToken> {
    return this.sign({}, userId, SELECTION_AUDIENCE, SELECTION_TOKEN_TTL_SECONDS);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, ACCESS_AUDIENCE);
    const claims = accessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthenticatedError();
    return claims.data;
  }

  /** Signature, audience and claims of a platform token; a tenant token is not one. */
  async verifyPlatformToken(token: string): Promise<PlatformTokenClaims> {
    const claims = platformTokenClaimsSchema.safeParse(await this.verify(token, PLATFORM_AUDIENCE));
    if (!claims.success) throw new UnauthenticatedError();
    return claims.data;
  }

  /** Returns the id of the user that logged in. */
  async verifySelectionToken(token: string): Promise<string> {
    const claims = selectionClaimsSchema.safeParse(await this.verify(token, SELECTION_AUDIENCE));
    if (!claims.success) throw new UnauthenticatedError();
    return claims.data.sub;
  }

  private async sign(
    claims: Record<string, string>,
    subject: string,
    audience: string,
    ttlSeconds: number,
  ): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds)
      .sign(this.key);
    return { token, expiresIn: ttlSeconds };
  }

  private async verify(token: string, audience: string): Promise<Record<string, unknown>> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience,
        currentDate: this.clock.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      return payload;
    } catch {
      throw new UnauthenticatedError();
    }
  }
}
