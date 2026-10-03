import { Injectable } from '@nestjs/common';
import { InvalidTokenError, type Organization } from '@procesabpm/shared';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import { LOGIN_LOCKOUT } from '../domain/auth-policy.js';
import type { LoginCandidate } from '../domain/login-candidate.js';

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
      SELECT id, password_hash AS "passwordHash", status::text AS status, mfa_enabled AS "mfaEnabled"
      FROM auth_find_user_by_email(${email})`;
    return row;
  }

  /** Needs `app.user_id` = `userId`: the e-mail is a public column the user can always read about themselves. */
  async findEmail(tx: AuthTransaction, userId: string): Promise<string | undefined> {
    return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email;
  }

  /** Needs `app.user_id` = the caller; revokes every other session of the user and clears the lockout. */
  async changeOwnPassword(tx: AuthTransaction, newPasswordHash: string, keepSessionId: string): Promise<void> {
    await tx.$executeRaw`SELECT auth_change_own_password(${newPasswordHash}, ${keepSessionId}::uuid)`;
  }

  /** Needs `app.user_id` = `userId`: a user is only told about themselves. */
  async isPlatformAdmin(tx: AuthTransaction, userId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT auth_is_platform_admin(${userId}::uuid) AS ok`;
    return row?.ok === true;
  }

  /**
   * Counts one login attempt, atomically, before the password is checked. `false`: the account is locked, not active or
   * unknown, and the password must not be tested against its real hash.
   */
  async claimLoginAttempt(tx: AuthTransaction, userId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ claimed: boolean }[]>`
      SELECT auth_claim_login_attempt(${userId}::uuid, ${LOGIN_LOCKOUT.maxFailedAttempts}::int, ${LOGIN_LOCKOUT.lockMinutes}::int) AS claimed`;
    return row?.claimed === true;
  }

  /** The password was right: gives the claimed attempt back; `signedIn` stamps the last login. */
  async recordPasswordSuccess(tx: AuthTransaction, userId: string, signedIn: boolean): Promise<void> {
    await tx.$executeRaw`SELECT auth_record_password_success(${userId}::uuid, ${signedIn})`;
  }

  /** Needs `app.user_id` = `userId`: does an ACTIVE membership sit in an organization that requires two-step verification? */
  async requiresMfaByMembership(tx: AuthTransaction, userId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ required: boolean }[]>`SELECT auth_mfa_required_by_membership(${userId}::uuid) AS required`;
    return row?.required === true;
  }

  /** Needs `app.user_id` = `userId`: the function only lists the caller's own organizations. */
  listOrganizations(tx: AuthTransaction, userId: string): Promise<Organization[]> {
    return tx.$queryRaw<Organization[]>`
      SELECT tenant_id AS "tenantId", tenant_slug AS slug, tenant_name AS name,
             membership_status::text AS "membershipStatus", tenant_mfa_required AS "mfaRequired"
      FROM auth_list_memberships(${userId}::uuid)
      ORDER BY tenant_name, tenant_id`;
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
