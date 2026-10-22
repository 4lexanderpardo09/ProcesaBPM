import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

@Injectable()
export class MembershipCompaniesRepository {
  async companyIdsOf(tx: TenantTransaction, tenantId: string, userId: string): Promise<string[]> {
    const rows = await tx.membershipCompany.findMany({ where: { tenantId, userId }, select: { companyId: true } });
    return rows.map((row) => row.companyId);
  }

  /** The user's active companies with their names, alphabetically. */
  async activeCompaniesOf(tx: TenantTransaction, tenantId: string, userId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await tx.membershipCompany.findMany({ where: { tenantId, userId, company: { isActive: true } }, select: { company: { select: { id: true, name: true } } } });
    return rows.map((row) => row.company).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
}
