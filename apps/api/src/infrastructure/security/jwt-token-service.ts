import { randomUUID } from 'node:crypto';
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
import type { ApiConfig } from '../../config/app-config.js';
import { API_CONFIG } from '../../config/tokens.js';
import { Clock } from '../clock.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SELECTION_TOKEN_TTL_SECONDS = 2 * 60;
/** Time to type the code from the authenticator app (or to scan the QR code and confirm the first one). */
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
/** A platform session is short and never renewed: after it, the administrator logs in again. */
export const PLATFORM_TOKEN_TTL_SECONDS = 15 * 60;

const ISSUER = 'procesabpm';
const ACCESS_AUDIENCE = 'procesabpm:api';
const SELECTION_AUDIENCE = 'procesabpm:tenant-selection';
const PLATFORM_AUDIENCE = 'procesabpm:platform';
const MFA_CHALLENGE_AUDIENCE = 'procesabpm:mfa-challenge';
const ALGORITHM = 'HS256';
const CLOCK_TOLERANCE_SECONDS = 5;

export interface IssuedToken {
  readonly token: string;
  readonly expiresIn: number;
}

const selectionClaimsSchema = z.object({ sub: uuidSchema, jti: uuidSchema, iat: z.number().int(), exp: z.number().int(), mfa: z.boolean() });
const challengeClaimsSchema = z.object({ sub: uuidSchema, jti: uuidSchema, iat: z.number().int(), exp: z.number().int(), purpose: z.enum(['VERIFY', 'ENROLL']) });

export type MfaChallengePurpose = 'VERIFY' | 'ENROLL';

/** The verified claims of an MFA challenge token (single-use, like the selection token). */
export interface MfaChallengeClaims {
  readonly userId: string;
  readonly jti: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly purpose: MfaChallengePurpose;
}

/** The verified claims of a selection token; `jti` is consumed in the database so the token works once. */
export interface SelectionTokenClaims {
  readonly userId: string;
  readonly jti: string;
  /** The second factor was verified (or no factor applies and none was needed) before this token was issued. */
  readonly mfa: boolean;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Signs and verifies the two short-lived JWTs. They use different audiences, so a selection
 * token is never accepted as an access token or the other way round. Claims carry ids only.
 */
@Injectable()
export class JwtTokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(API_CONFIG) config: ApiConfig,
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

  /** `mfa`: the user passed the second factor in this sign-in. A session opened with it is marked as verified. */
  issueSelectionToken(userId: string, options: { mfa: boolean }): Promise<IssuedToken> {
    return this.sign({ mfa: options.mfa }, userId, SELECTION_AUDIENCE, SELECTION_TOKEN_TTL_SECONDS, randomUUID());
  }

  /** The proof that the password was right, exchanged for a selection token after the second factor. */
  issueMfaChallenge(userId: string, purpose: MfaChallengePurpose): Promise<IssuedToken> {
    return this.sign({ purpose }, userId, MFA_CHALLENGE_AUDIENCE, MFA_CHALLENGE_TTL_SECONDS, randomUUID());
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

  async verifySelectionToken(token: string): Promise<SelectionTokenClaims> {
    const claims = selectionClaimsSchema.safeParse(await this.verify(token, SELECTION_AUDIENCE));
    if (!claims.success) throw new UnauthenticatedError();
    const { sub, jti, iat, exp, mfa } = claims.data;
    return { userId: sub, jti, mfa, issuedAt: new Date(iat * 1000), expiresAt: new Date(exp * 1000) };
  }

  /** Signature, audience, claims and purpose: a challenge for enrollment does not verify a code, nor the other way round. */
  async verifyMfaChallenge(token: string, purpose: MfaChallengePurpose): Promise<MfaChallengeClaims> {
    const claims = challengeClaimsSchema.safeParse(await this.verify(token, MFA_CHALLENGE_AUDIENCE));
    if (!claims.success || claims.data.purpose !== purpose) throw new UnauthenticatedError();
    const { sub, jti, iat, exp } = claims.data;
    return { userId: sub, jti, purpose, issuedAt: new Date(iat * 1000), expiresAt: new Date(exp * 1000) };
  }

  private async sign(
    claims: Record<string, string | boolean>,
    subject: string,
    audience: string,
    ttlSeconds: number,
    tokenId?: string,
  ): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds);
    const token = await (tokenId === undefined ? jwt : jwt.setJti(tokenId)).sign(this.key);
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
