import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TenantAccess {
  readonly membership:
    | {
        readonly roleId: string;
        readonly roleActive: boolean;
        readonly roleIsAdmin: boolean;
        readonly permissionsVersion: number;
        readonly isOwner: boolean;
        readonly departmentId: string | null;
        readonly siteId: string | null;
        readonly positionId: string | null;
      }
    | undefined;
  readonly userStatus: 'ACTIVE' | 'LOCKED' | 'DISABLED' | undefined;
  readonly membershipStatus: 'INVITED' | 'ACTIVE' | 'INACTIVE' | undefined;
  readonly tenantStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED' | 'PENDING_DELETION' | 'PURGED' | undefined;
  /** The organization requires two-step verification from its members. */
  readonly tenantMfaRequired: boolean;
}

export interface SessionState {
  readonly activeTenantId: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly mfaVerified: boolean;
}

/** Runs inside the tenant transaction of the user being checked. */
@Injectable()
export class TenantAccessRepository {
  async findAccess(tx: TenantTransaction, tenantId: string, userId: string): Promise<TenantAccess> {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: {
        status: true,
        roleId: true,
        isOwner: true,
        departmentId: true,
        siteId: true,
        positionId: true,
        role: { select: { isActive: true, isAdmin: true, permissionsVersion: true } },
      },
    });
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true, mfaRequired: true } });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    return {
      userStatus: user?.status,
      membershipStatus: membership?.status,
      tenantStatus: tenant?.status,
      tenantMfaRequired: tenant?.mfaRequired ?? false,
      membership:
        membership === null
          ? undefined
          : {
              roleId: membership.roleId,
              roleActive: membership.role.isActive,
              roleIsAdmin: membership.role.isAdmin,
              permissionsVersion: membership.role.permissionsVersion,
              isOwner: membership.isOwner,
              departmentId: membership.departmentId,
              siteId: membership.siteId,
              positionId: membership.positionId,
            },
    };
  }

  async findSession(tx: TenantTransaction, sessionId: string): Promise<SessionState | undefined> {
    const session = await tx.refreshSession.findUnique({
      where: { id: sessionId },
      select: { activeTenantId: true, expiresAt: true, revokedAt: true, mfaVerified: true },
    });
    return session ?? undefined;
  }
}
