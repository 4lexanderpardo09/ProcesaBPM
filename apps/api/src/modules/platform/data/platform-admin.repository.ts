import { Injectable } from '@nestjs/common';
import type { PlatformAdminSummary } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface NewAdminIdentity {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

const SUMMARY_SELECT = {
  createdAt: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true, status: true, mfaEnabled: true, lastLoginAt: true } },
} as const;

type AdminRow = { createdAt: Date; user: { id: string; email: string; firstName: string; lastName: string; status: PlatformAdminSummary['status']; mfaEnabled: boolean; lastLoginAt: Date | null } };

const toSummary = ({ createdAt, user }: AdminRow): PlatformAdminSummary => ({
  userId: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  status: user.status,
  mfaEnabled: user.mfaEnabled,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: createdAt.toISOString(),
});

@Injectable()
export class PlatformAdminRepository {
  async list(tx: PlatformTransaction): Promise<PlatformAdminSummary[]> {
    const rows = await tx.platformAdmin.findMany({ select: SUMMARY_SELECT, orderBy: { createdAt: 'asc' } });
    return rows.map(toSummary);
  }

  /**
   * Locks every admin row: two simultaneous revocations cannot both pass the "someone remains" check. `usable` means the
   * person can sign in today: an active account that has chosen a password (an invited admin who never did cannot).
   */
  async lockAll(tx: PlatformTransaction): Promise<Array<{ userId: string; usable: boolean }>> {
    const rows = await tx.$queryRaw<Array<{ user_id: string; usable: boolean }>>`
      SELECT pa.user_id::text AS user_id, (u.status = 'ACTIVE' AND u.password_hash IS NOT NULL) AS usable
      FROM platform_admins pa JOIN users u ON u.id = pa.user_id
      FOR UPDATE OF pa`;
    return rows.map((row) => ({ userId: row.user_id, usable: row.usable }));
  }

  async findUserByEmail(tx: PlatformTransaction, email: string): Promise<{ id: string; status: string } | undefined> {
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, status: true } });
    return user ?? undefined;
  }

  async createUser(tx: PlatformTransaction, identity: NewAdminIdentity): Promise<string> {
    const user = await tx.user.create({ data: identity, select: { id: true } });
    return user.id;
  }

  async add(tx: PlatformTransaction, userId: string): Promise<void> {
    await tx.platformAdmin.create({ data: { userId } });
  }

  async remove(tx: PlatformTransaction, userId: string): Promise<void> {
    await tx.platformAdmin.delete({ where: { userId } });
  }

  /** Platform sessions are the ones without an active tenant. */
  async revokePlatformSessions(tx: PlatformTransaction, userId: string): Promise<void> {
    await tx.refreshSession.updateMany({ where: { userId, activeTenantId: null, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
