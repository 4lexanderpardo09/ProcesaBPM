import { Inject, Injectable } from '@nestjs/common';
import { type AvailableCatalogResponse, findEngineSupportProblems, InvalidReferenceError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CreationGate } from '../../engine/application/creation-gate.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { CategoryRepository } from '../data/category.repository.js';
import { MembershipCompaniesRepository } from '../data/membership-companies.repository.js';

export interface CatalogViewer {
  readonly userId: string;
  readonly departmentId: string | null;
}

type Categories = AvailableCatalogResponse['categories'];

/**
 * What the person creating a ticket can pick, for their company and department. Only what they could really start:
 * a subcategory without a published, runnable workflow, or whose START blocks do not admit them (initiators) for any
 * of the companies asked about, is left out, so the catalog never offers what creating the ticket would refuse.
 */
@Injectable()
export class AvailableCatalogService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CategoryRepository) private readonly categories: CategoryRepository,
    @Inject(MembershipCompaniesRepository) private readonly memberships: MembershipCompaniesRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(CreationGate) private readonly gate: CreationGate,
  ) {}

  /** With `companyId`, the view for that company (one of the user's); without it, for all the user's companies. */
  available(viewer: CatalogViewer, companyId?: string): Promise<AvailableCatalogResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const ownCompanyIds = await this.memberships.companyIdsOf(tx, tenantId, viewer.userId);
      if (companyId !== undefined && !ownCompanyIds.includes(companyId)) {
        throw new InvalidReferenceError('The company is not one of the user\'s companies');
      }
      const companyIds = companyId === undefined ? ownCompanyIds : [companyId];
      const visible = await this.categories.findVisible(tx, tenantId, { companyIds, departmentId: viewer.departmentId });
      return { categories: await this.startable(tx, tenantId, viewer.userId, companyIds, visible) };
    });
  }

  private async startable(tx: TenantTransaction, tenantId: string, userId: string, companyIds: readonly string[], categories: Categories): Promise<Categories> {
    const requester = await this.gate.requesterOf(tx, tenantId, userId);
    if (requester === null) return [];
    const published = await this.versions.findForSubcategories(tx, tenantId, categories.flatMap((category) => category.subcategories.map((subcategory) => subcategory.id)));
    const admitted = await this.gate.startFilterFor(tx, tenantId, requester);
    const canStart = (subcategoryId: string): boolean => {
      const version = published.get(subcategoryId);
      if (version === undefined || findEngineSupportProblems(version.document).some((problem) => problem.severity === 'error')) return false;
      const starts = version.document.steps.filter((step) => step.type === 'START');
      return companyIds.some((id) => admitted(starts, id).length > 0);
    };
    return categories
      .map((category) => ({ ...category, subcategories: category.subcategories.filter((subcategory) => canStart(subcategory.id)) }))
      .filter((category) => category.subcategories.length > 0);
  }
}
