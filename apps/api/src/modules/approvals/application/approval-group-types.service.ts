import { Inject, Injectable } from '@nestjs/common';
import {
  type ApprovalGroupTypeRequest,
  type ApprovalGroupTypeResponse,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
} from '@procesabpm/shared';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ApprovalGroupTypeRepository, type ApprovalGroupTypeRow } from '../data/approval-group-type.repository.js';

const toResponse = (row: ApprovalGroupTypeRow): ApprovalGroupTypeResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class ApprovalGroupTypesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(ApprovalGroupTypeRepository) private readonly repository: ApprovalGroupTypeRepository,
  ) {}

  list(query: PageQuery): Promise<Page<ApprovalGroupTypeResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<ApprovalGroupTypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: ApprovalGroupTypeRequest): Promise<ApprovalGroupTypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.repository.create(tx, this.tenantId, request.name)));
  }

  rename(id: string, request: ApprovalGroupTypeRequest): Promise<ApprovalGroupTypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.rename(tx, this.tenantId, id, request.name);
      return toResponse(await this.require(tx, id));
    });
  }

  /** The default type and any type still used by a group or a workflow step are kept. */
  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const type = await this.require(tx, id);
      if (type.isDefault) throw new InvalidStateError('The default type cannot be deleted');
      if ((await this.repository.countUsages(tx, this.tenantId, id)) > 0) throw new InvalidStateError('The type is still used by groups or workflow steps');
      await this.repository.remove(tx, this.tenantId, id);
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<ApprovalGroupTypeRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
