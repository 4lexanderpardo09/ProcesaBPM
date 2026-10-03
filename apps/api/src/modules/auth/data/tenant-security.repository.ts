import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** The security policy of one organization, read and written in its own tenant transaction. */
@Injectable()
export class TenantSecurityRepository {
  async mfaRequired(tx: TenantTransaction, tenantId: string): Promise<boolean> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { mfaRequired: true } });
    return tenant?.mfaRequired ?? false;
  }

  async setMfaRequired(tx: TenantTransaction, tenantId: string, mfaRequired: boolean): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { mfaRequired }, select: { id: true } });
  }

  /** ACTIVE members who have not set up the second factor: what turning the policy on would sign out. */
  activeMembersWithoutMfa(tx: TenantTransaction, tenantId: string): Promise<number> {
    return tx.membership.count({ where: { tenantId, status: 'ACTIVE', user: { mfaEnabled: false } } });
  }

  /** Is the session the administrator is using one that passed the second factor? */
  async sessionMfaVerified(tx: TenantTransaction, sessionId: string): Promise<boolean> {
    const session = await tx.refreshSession.findUnique({ where: { id: sessionId }, select: { mfaVerified: true } });
    return session?.mfaVerified === true;
  }
}
