import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import { MFA_POLICY } from '../domain/auth-policy.js';

export interface MfaStatus {
  readonly enabled: boolean;
  readonly secretEncrypted: Buffer | null;
  readonly enabledAt: Date | null;
  readonly backupCodesLeft: number;
}

/**
 * The second factor through its `SECURITY DEFINER` functions (docs/base-de-datos.md §6.4). Every call needs
 * `app.user_id` = the user: the functions only ever act on the caller.
 */
@Injectable()
export class MfaRepository {
  async status(tx: AuthTransaction): Promise<MfaStatus> {
    const [row] = await tx.$queryRaw<Array<{ enabled: boolean; secret: Buffer | null; enabledAt: Date | null; left: number }>>`
      SELECT enabled, secret_encrypted AS secret, enabled_at AS "enabledAt", backup_codes_left AS "left" FROM auth_mfa_status()`;
    return { enabled: row?.enabled ?? false, secretEncrypted: row?.secret == null ? null : Buffer.from(row.secret), enabledAt: row?.enabledAt ?? null, backupCodesLeft: row?.left ?? 0 };
  }

  /** 23514 when MFA is already on. */
  async storePendingSecret(tx: AuthTransaction, sealedSecret: Buffer): Promise<void> {
    await tx.$executeRaw`SELECT auth_store_pending_mfa_secret(${sealedSecret}::bytea)`;
  }

  /** Counts one attempt before the code is checked; `false` = locked (or the account is not active). */
  async claimAttempt(tx: AuthTransaction): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ claimed: boolean }>>`
      SELECT auth_claim_mfa_attempt(${MFA_POLICY.maxFailedAttempts}::int, ${MFA_POLICY.lockMinutes}::int) AS claimed`;
    return row?.claimed === true;
  }

  /** `false` when the step was already accepted (or an older one): a code works once. */
  async acceptTotpStep(tx: AuthTransaction, step: number, enabled: boolean): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ accepted: boolean }>>`SELECT auth_accept_totp_step(${step}::bigint, ${enabled}) AS accepted`;
    return row?.accepted === true;
  }

  /** The codes left, or `undefined` when no unused code has that hash. */
  async useBackupCode(tx: AuthTransaction, codeHash: string): Promise<number | undefined> {
    const [row] = await tx.$queryRaw<Array<{ left: number | null }>>`SELECT auth_use_backup_code(${codeHash}) AS "left"`;
    return row?.left ?? undefined;
  }

  /** 23514 unless the first code was accepted and exactly ten distinct hashes are given. Revokes the other sessions. */
  async enable(tx: AuthTransaction, backupCodeHashes: readonly string[], keepSessionId: string | null): Promise<void> {
    await tx.$executeRaw`SELECT auth_enable_mfa(${[...backupCodeHashes]}::text[], ${keepSessionId}::uuid)`;
  }

  async replaceBackupCodes(tx: AuthTransaction, backupCodeHashes: readonly string[]): Promise<void> {
    await tx.$executeRaw`SELECT auth_replace_backup_codes(${[...backupCodeHashes]}::text[])`;
  }

  /** 23514 when MFA is off or required by policy. Revokes the other sessions. */
  async disable(tx: AuthTransaction, keepSessionId: string | null): Promise<void> {
    await tx.$executeRaw`SELECT auth_disable_mfa(${keepSessionId}::uuid)`;
  }

  async reencryptSecret(tx: AuthTransaction, oldSealed: Buffer, newSealed: Buffer): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ swapped: boolean }>>`SELECT auth_reencrypt_mfa_secret(${oldSealed}::bytea, ${newSealed}::bytea) AS swapped`;
    return row?.swapped === true;
  }
}
