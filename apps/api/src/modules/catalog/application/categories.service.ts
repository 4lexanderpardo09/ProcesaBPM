import { Inject, Injectable } from '@nestjs/common';
import {
  type CategoryRequest,
  type CategoryResponse,
  type CategoryVisibilityResponse,
  NotFoundError,
  type Page,
  type PageQuery,
  type ReplaceCategoryVisibilityRequest,
} from '@procesabpm/shared';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CategoryRepository, type CategoryRow } from '../data/category.repository.js';

const toResponse = (row: CategoryRow): CategoryResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CategoryRepository) private readonly repository: CategoryRepository,
  ) {}

  list(query: PageQuery): Promise<Page<CategoryResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<CategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: CategoryRequest): Promise<CategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.repository.create(tx, this.tenantId, request.name)));
  }

  rename(id: string, request: CategoryRequest): Promise<CategoryResponse> {
    return this.change(id, { name: request.name });
  }

  activate(id: string): Promise<CategoryResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<CategoryResponse> {
    return this.change(id, { isActive: false });
  }

  visibility(id: string): Promise<CategoryVisibilityResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return this.repository.findVisibility(tx, this.tenantId, id);
    });
  }

  /** Replaces both lists; a company or department of another tenant is refused by the composite foreign keys. */
  replaceVisibility(id: string, request: ReplaceCategoryVisibilityRequest): Promise<CategoryVisibilityResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.replaceVisibility(tx, this.tenantId, id, request);
      return this.repository.findVisibility(tx, this.tenantId, id);
    });
  }

  private change(id: string, data: { name?: string; isActive?: boolean }): Promise<CategoryResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<CategoryRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
