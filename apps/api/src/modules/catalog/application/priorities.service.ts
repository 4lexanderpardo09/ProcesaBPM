import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePriorityRequest,
  NotFoundError,
  type Page,
  type PageQuery,
  type PriorityResponse,
  type UpdatePriorityRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PriorityRepository, type PriorityRow, type PriorityWrite } from '../data/priority.repository.js';

@Injectable()
export class PrioritiesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(PriorityRepository) private readonly repository: PriorityRepository,
  ) {}

  list(query: PageQuery): Promise<Page<PriorityResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, (row) => row);
    });
  }

  get(id: string): Promise<PriorityResponse> {
    return this.runner.withTenantTransaction((tx) => this.require(tx, id));
  }

  create(request: CreatePriorityRequest): Promise<PriorityResponse> {
    return this.runner.withTenantTransaction((tx) =>
      this.repository.create(tx, this.tenantId, { name: request.name, ...compact({ sortOrder: request.sortOrder, color: request.color }) }),
    );
  }

  update(id: string, request: UpdatePriorityRequest): Promise<PriorityResponse> {
    return this.change(id, compact(request));
  }

  activate(id: string): Promise<PriorityResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<PriorityResponse> {
    return this.change(id, { isActive: false });
  }

  private change(id: string, data: PriorityWrite): Promise<PriorityResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return this.require(tx, id);
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<PriorityRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
