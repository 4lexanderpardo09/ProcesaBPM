import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TenantAccess {
  readonly membershipStatus: 'INVITED' | 'ACTIVE' | 'INACTIVE' | undefined;
  readonly tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED' | undefined;
}

export interface SessionState {
  readonly activeTenantId: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** Runs inside the tenant transaction of the user being checked. */
@Injectable()
export class TenantAccessRepository {
  async findAccess(tx: TenantTransaction, tenantId: string, userId: string): Promise<TenantAccess> {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { status: true },
    });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    return { membershipStatus: membership?.status, tenantStatus: tenant?.status };
  }

  async findSession(tx: TenantTransaction, sessionId: string): Promise<SessionState | undefined> {
    const session = await tx.refreshSession.findUnique({
      where: { id: sessionId },
      select: { activeTenantId: true, expiresAt: true, revokedAt: true },
    });
    return session ?? undefined;
  }
}
