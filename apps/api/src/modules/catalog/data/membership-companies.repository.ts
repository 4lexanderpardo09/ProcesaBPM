import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

@Injectable()
export class MembershipCompaniesRepository {
  async companyIdsOf(tx: TenantTransaction, tenantId: string, userId: string): Promise<string[]> {
    const rows = await tx.membershipCompany.findMany({ where: { tenantId, userId }, select: { companyId: true } });
    return rows.map((row) => row.companyId);
  }
}
