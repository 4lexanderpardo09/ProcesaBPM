import type { AccessTokenResponse } from '@procesabpm/shared';
import { z } from 'zod';
import { UnexpectedResponseError } from '@/shared/api';

export interface SessionIdentity {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
}

export interface AccessToken {
  readonly value: string;
  /** Local clock, not the `exp` claim: the browser clock may be off, the lifetime it was told is not. */
  readonly receivedAt: number;
  readonly expiresAt: number;
  readonly identity: SessionIdentity;
}

const claimsSchema = z.object({ sub: z.string().min(1), tid: z.string().min(1), sid: z.string().min(1) });

/**
 * Reads who the token is for, without verifying the signature: the claims only route the UI and
 * compare identities, they are never proof of anything (the API verifies every request).
 */
export function decodeIdentity(jwt: string): SessionIdentity | undefined {
  const payload = jwt.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const claims = claimsSchema.safeParse(JSON.parse(decodeBase64Url(payload)));
    return claims.success ? { userId: claims.data.sub, tenantId: claims.data.tid, sessionId: claims.data.sid } : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function accessTokenOf(value: string, receivedAt: number, expiresAt: number): AccessToken | undefined {
  const identity = decodeIdentity(value);
  return identity === undefined ? undefined : { value, receivedAt, expiresAt, identity };
}

export function toAccessToken(response: AccessTokenResponse, now: number): AccessToken {
  const token = accessTokenOf(response.accessToken, now, now + response.expiresIn * 1000);
  if (token === undefined) throw new UnexpectedResponseError(200, new Error('The access token has no session claims'));
  return token;
}

/** Same person in the same organization; the session id changes on every refresh. */
export function sameIdentity(a: SessionIdentity | undefined, b: SessionIdentity | undefined): boolean {
  return a !== undefined && b !== undefined && a.userId === b.userId && a.tenantId === b.tenantId;
}
