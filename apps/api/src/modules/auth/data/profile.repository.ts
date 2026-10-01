import { Injectable } from '@nestjs/common';
import type { MeResponse } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

@Injectable()
export class ProfileRepository {
  /** Public columns only: the sensitive ones are omitted by the client and not readable by the role. */
  async findProfile(tx: TenantTransaction, tenantId: string, userId: string): Promise<MeResponse | undefined> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        timeZone: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
      },
    });
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: {
        tenantId: true,
        status: true,
        isOwner: true,
        role: { select: { id: true, name: true, isAdmin: true } },
        companies: { select: { company: { select: { id: true, name: true, isDefault: true } } } },
      },
    });
    if (user === null || membership === null || membership.status !== 'ACTIVE') return undefined;
    return {
      user: { ...user, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null },
      membership: {
        tenantId: membership.tenantId,
        status: membership.status,
        isOwner: membership.isOwner,
        role: membership.role,
        companies: membership.companies
          .map(({ company }) => company)
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
      },
    };
  }
}
