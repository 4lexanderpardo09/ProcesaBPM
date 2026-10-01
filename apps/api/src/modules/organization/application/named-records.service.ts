import { type NamedRecordRequest, type NamedRecordResponse, NotFoundError, type Page, type PageQuery } from '@procesabpm/shared';
import { toPage } from '../../../common/crud/pagination.js';
import type { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { NamedRecordRepository, NamedRecordRow } from '../data/named-record.repository.js';

const toResponse = (row: NamedRecordRow): NamedRecordResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Use cases shared by departments and positions. */
export abstract class NamedRecordsService {
  protected constructor(
    private readonly runner: TenantTransactionRunner,
    private readonly context: TenantContext,
    private readonly repository: NamedRecordRepository,
  ) {}

  list(query: PageQuery): Promise<Page<NamedRecordResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<NamedRecordResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.repository.create(tx, this.tenantId, request.name)));
  }

  rename(id: string, request: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.change(id, { name: request.name });
  }

  activate(id: string): Promise<NamedRecordResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<NamedRecordResponse> {
    return this.change(id, { isActive: false });
  }

  private change(id: string, data: { name?: string; isActive?: boolean }): Promise<NamedRecordResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<NamedRecordRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
