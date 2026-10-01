import { Injectable } from '@nestjs/common';
import { InvalidTokenError, type Organization } from '@procesabpm/shared';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import { LOGIN_LOCKOUT } from '../domain/auth-policy.js';
import type { LoginCandidate } from '../domain/login-eligibility.js';

export type UserTokenType = 'PASSWORD_RESET' | 'INVITATION' | 'EMAIL_VERIFICATION' | 'EMAIL_CHANGE';

export interface StoredUserToken {
  readonly userId: string;
  readonly type: UserTokenType;
}

export interface ConsumedUserToken {
  readonly userId: string;
  readonly type: UserTokenType;
  readonly invitedTenantId: string | null;
}

/** Credentials only through the `SECURITY DEFINER` `auth_*` functions (docs/base-de-datos.md §6.4). */
@Injectable()
export class CredentialsRepository {
  async findLoginCandidate(tx: AuthTransaction, email: string): Promise<LoginCandidate | undefined> {
    const [row] = await tx.$queryRaw<LoginCandidate[]>`
      SELECT id, password_hash AS "passwordHash", status::text AS status,
             locked_until AS "lockedUntil", mfa_enabled AS "mfaEnabled"
      FROM auth_find_user_by_email(${email})`;
    return row;
  }

  /** Needs `app.user_id` = `userId`: a user is only told about themselves. */
  async isPlatformAdmin(tx: AuthTransaction, userId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT auth_is_platform_admin(${userId}::uuid) AS ok`;
    return row?.ok === true;
  }

  async registerLoginAttempt(tx: AuthTransaction, userId: string, success: boolean): Promise<void> {
    await tx.$executeRaw`
      SELECT auth_register_login_attempt(${userId}::uuid, ${success}, ${LOGIN_LOCKOUT.maxFailedAttempts}::int,
                                         ${LOGIN_LOCKOUT.lockMinutes}::int)`;
  }

  /** Needs `app.user_id` = `userId`: the function only lists the caller's own organizations. */
  listOrganizations(tx: AuthTransaction, userId: string): Promise<Organization[]> {
    return tx.$queryRaw<Organization[]>`
      SELECT tenant_id AS "tenantId", tenant_slug AS slug, tenant_name AS name,
             membership_status::text AS "membershipStatus"
      FROM auth_list_memberships(${userId}::uuid)
      ORDER BY tenant_name, tenant_id`;
  }

  async issueToken(
    tx: AuthTransaction,
    token: { userId: string; type: UserTokenType; tokenHash: string; expiresAt: Date },
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT auth_issue_user_token(${token.userId}::uuid, ${token.type}::user_token_type, ${token.tokenHash},
                                   ${token.expiresAt}::timestamptz, NULL::jsonb)::text AS id`;
  }

  /** Only tokens that can still be used. */
  async findUsableToken(tx: AuthTransaction, tokenHash: string, now: Date): Promise<StoredUserToken | undefined> {
    const [row] = await tx.$queryRaw<StoredUserToken[]>`
      SELECT user_id AS "userId", type::text AS type
      FROM auth_find_user_token(${tokenHash})
      WHERE consumed_at IS NULL AND expires_at > ${now}::timestamptz`;
    return row;
  }

  /**
   * Raises 42501 when the token is unknown, used or expired, and 23514 when a needed password is
   * missing or when an invitation sends one for a user who already has a password.
   */
  async consumeToken(tx: AuthTransaction, tokenHash: string, newPasswordHash: string | null): Promise<ConsumedUserToken> {
    const [row] = await tx.$queryRaw<ConsumedUserToken[]>`
      SELECT user_id AS "userId", token_type::text AS type, invited_tenant_id AS "invitedTenantId"
      FROM auth_consume_user_token(${tokenHash}, ${newPasswordHash}::text)`;
    if (row === undefined) throw new InvalidTokenError();
    return row;
  }
}
