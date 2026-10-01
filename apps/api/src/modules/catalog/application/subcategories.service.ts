import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateSubcategoryRequest,
  NotFoundError,
  type Page,
  type PageQuery,
  type SubcategoryResponse,
  type UpdateSubcategoryRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SubcategoryRepository, type SubcategoryRow, type SubcategoryWrite } from '../data/subcategory.repository.js';

const toResponse = (row: SubcategoryRow): SubcategoryResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class SubcategoriesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(SubcategoryRepository) private readonly repository: SubcategoryRepository,
  ) {}

  list(query: PageQuery, categoryId?: string): Promise<Page<SubcategoryResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query, categoryId);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<SubcategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  /** The category and the default priority must be of the tenant: the composite foreign keys enforce it (422). */
  create(request: CreateSubcategoryRequest): Promise<SubcategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) =>
      toResponse(
        await this.repository.create(tx, this.tenantId, {
          categoryId: request.categoryId,
          name: request.name,
          ...compact({ description: request.description, defaultPriorityId: request.defaultPriorityId }),
        }),
      ),
    );
  }

  update(id: string, request: UpdateSubcategoryRequest): Promise<SubcategoryResponse> {
    return this.change(id, compact(request));
  }

  activate(id: string): Promise<SubcategoryResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<SubcategoryResponse> {
    return this.change(id, { isActive: false });
  }

  private change(id: string, data: SubcategoryWrite): Promise<SubcategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<SubcategoryRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
