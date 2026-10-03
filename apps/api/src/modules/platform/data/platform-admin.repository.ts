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

  /** Locks every admin row: two simultaneous revocations cannot both pass the "someone remains" check. */
  async lockAllIds(tx: PlatformTransaction): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ user_id: string }>>`SELECT user_id::text AS user_id FROM platform_admins FOR UPDATE`;
    return rows.map((row) => row.user_id);
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
