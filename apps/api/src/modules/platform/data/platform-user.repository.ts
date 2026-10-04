import { Injectable } from '@nestjs/common';
import { hasSqlState, type MfaResetVerificationMethod, type PlatformUserResponse, ValidationFailedError } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface MfaResetCommand {
  readonly administratorId: string;
  readonly userId: string;
  readonly reason: string;
  readonly method: MfaResetVerificationMethod;
  readonly reference: string;
  readonly tenantAdminUserId: string | null;
  readonly ipAddress: string | null;
}

export interface MfaResetResult {
  readonly resetAt: Date;
  readonly revokedSessions: number;
}

/** `platform_reset_user_mfa` checks its arguments with 22023 (the request schema checks the same, so it should not happen). */
const INVALID_PARAMETER_VALUE = '22023';

/** Explicit columns only: never the credentials or the second factor of the account. */
const LOOKUP_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  status: true,
  mfaEnabled: true,
  platformAdmin: { select: { userId: true } },
  memberships: { select: { tenantId: true, status: true, isOwner: true, tenant: { select: { name: true } } }, orderBy: { tenantId: 'asc' } },
} as const;

@Injectable()
export class PlatformUserRepository {
  async findByEmail(tx: PlatformTransaction, email: string): Promise<PlatformUserResponse | undefined> {
    const user = await tx.user.findUnique({ where: { email }, select: LOOKUP_SELECT });
    if (user === null) return undefined;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      isPlatformAdmin: user.platformAdmin !== null,
      memberships: user.memberships.map((membership) => ({ tenantId: membership.tenantId, tenantName: membership.tenant.name, status: membership.status, isOwner: membership.isOwner })),
    };
  }

  async exists(tx: PlatformTransaction, userId: string): Promise<boolean> {
    return (await tx.user.count({ where: { id: userId } })) > 0;
  }

  /**
   * `platform_reset_user_mfa` (docs/base-de-datos.md §8.29) does the whole reset and both trails. `undefined` when the
   * user does not exist or has no second factor. Its argument checks (22023) answer 400, like the request schema.
   */
  async resetMfa(tx: PlatformTransaction, command: MfaResetCommand): Promise<MfaResetResult | undefined> {
    try {
      return await this.callReset(tx, command);
    } catch (error) {
      if (hasSqlState(error, INVALID_PARAMETER_VALUE)) throw new ValidationFailedError([{ path: '', message: 'The reason, the reference or the verification method is not valid' }]);
      throw error;
    }
  }

  private async callReset(tx: PlatformTransaction, command: MfaResetCommand): Promise<MfaResetResult | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_reset_at: Date; out_revoked_sessions: number }>>`
      SELECT out_reset_at, out_revoked_sessions
      FROM platform_reset_user_mfa(${command.administratorId}::uuid, ${command.userId}::uuid, ${command.reason}, ${command.method},
                                   ${command.reference}, ${command.tenantAdminUserId}::uuid, ${command.ipAddress})`;
    return row === undefined ? undefined : { resetAt: row.out_reset_at, revokedSessions: row.out_revoked_sessions };
  }
}
