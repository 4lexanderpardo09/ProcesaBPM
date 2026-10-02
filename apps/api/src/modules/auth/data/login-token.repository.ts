import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';

export type LoginTokenPurpose = 'TENANT_SELECTION' | 'MFA_CHALLENGE';

export interface LoginTokenClaims {
  readonly userId: string;
  readonly jti: string;
  /** Whole seconds, as in the JWT: the database refuses a token issued before the last password change. */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/** `consumed_auth_tokens` through its `SECURITY DEFINER` function: each login token works once. */
@Injectable()
export class LoginTokenRepository {
  /** Worker only: forgets the ids that expired more than an hour ago. */
  async purgeExpired(tx: CrossTenantTransaction): Promise<number> {
    const [row] = await tx.$queryRaw<{ purged: bigint }[]>`SELECT purge_consumed_auth_tokens() AS purged`;
    return Number(row?.purged ?? 0);
  }

  /** `false` when the token was already used, expired, predates a password change or its account is not active. */
  async consume(tx: AuthTransaction, claims: LoginTokenClaims, purpose: LoginTokenPurpose): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT auth_consume_login_token(${claims.jti}::uuid, ${claims.userId}::uuid, ${purpose}, ${claims.issuedAt}::timestamptz,
                                      ${claims.expiresAt}::timestamptz) AS ok`;
    return row?.ok === true;
  }
}
