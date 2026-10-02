import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';

export interface SessionLookup {
  readonly id: string;
  readonly userId: string;
}

export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly activeTenantId: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBy: string | null;
  readonly mfaVerified: boolean;
}

export interface NewSession {
  readonly userId: string;
  /** `null` for a platform session. */
  readonly activeTenantId: string | null;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** The second factor was verified in the sign-in that opened this session. */
  readonly mfaVerified: boolean;
}

/** `refresh_sessions`: only the SHA-256 of each refresh token is stored. */
@Injectable()
export class SessionRepository {
  /** Works without a user: resolves who owns the token. */
  async findOwnerByTokenHash(tx: AuthTransaction, tokenHash: string): Promise<SessionLookup | undefined> {
    const [row] = await tx.$queryRaw<SessionLookup[]>`
      SELECT id, user_id AS "userId" FROM auth_find_refresh_session(${tokenHash})`;
    return row;
  }

  /** The rest needs `app.user_id` = the owner (row-level security of `refresh_sessions`). */
  async findById(tx: AuthTransaction, id: string): Promise<StoredSession | undefined> {
    const session = await tx.refreshSession.findUnique({
      where: { id },
      select: { id: true, userId: true, activeTenantId: true, expiresAt: true, revokedAt: true, replacedBy: true, mfaVerified: true },
    });
    return session ?? undefined;
  }

  /** Locks the row until the end of the transaction, so that concurrent rotations run one after the other. */
  async findByIdForUpdate(tx: AuthTransaction, id: string): Promise<StoredSession | undefined> {
    const [row] = await tx.$queryRaw<StoredSession[]>`
      SELECT id, user_id AS "userId", active_tenant_id AS "activeTenantId", expires_at AS "expiresAt",
             revoked_at AS "revokedAt", replaced_by AS "replacedBy", mfa_verified AS "mfaVerified"
      FROM refresh_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    return row;
  }

  async create(tx: AuthTransaction, session: NewSession): Promise<string> {
    const { id } = await tx.refreshSession.create({ data: session, select: { id: true } });
    return id;
  }

  async markReplaced(tx: AuthTransaction, id: string, replacedBy: string, now: Date): Promise<void> {
    await tx.refreshSession.update({ where: { id }, data: { revokedAt: now, replacedBy }, select: { id: true } });
  }

  async revoke(tx: AuthTransaction, id: string, now: Date): Promise<void> {
    await tx.refreshSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  }

  async revokeAllOfUser(tx: AuthTransaction, userId: string, now: Date): Promise<void> {
    await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  }
}
