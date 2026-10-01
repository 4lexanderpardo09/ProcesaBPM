import { Inject, Injectable } from '@nestjs/common';
import { type AvailableCatalogResponse, InvalidReferenceError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CategoryRepository } from '../data/category.repository.js';
import { MembershipCompaniesRepository } from '../data/membership-companies.repository.js';

export interface CatalogViewer {
  readonly userId: string;
  readonly departmentId: string | null;
}

/** What the person creating a ticket can pick, for their company and department. */
@Injectable()
export class AvailableCatalogService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CategoryRepository) private readonly categories: CategoryRepository,
    @Inject(MembershipCompaniesRepository) private readonly memberships: MembershipCompaniesRepository,
  ) {}

  /** With `companyId`, the view for that company (one of the user's); without it, for all the user's companies. */
  available(viewer: CatalogViewer, companyId?: string): Promise<AvailableCatalogResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const ownCompanyIds = await this.memberships.companyIdsOf(tx, tenantId, viewer.userId);
      if (companyId !== undefined && !ownCompanyIds.includes(companyId)) {
        throw new InvalidReferenceError('The company is not one of the user\'s companies');
      }
      const categories = await this.categories.findVisible(tx, tenantId, {
        companyIds: companyId === undefined ? ownCompanyIds : [companyId],
        departmentId: viewer.departmentId,
      });
      return { categories };
    });
  }
}
