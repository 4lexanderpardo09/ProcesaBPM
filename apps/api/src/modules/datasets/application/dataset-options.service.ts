import { Inject, Injectable } from '@nestjs/common';
import { type DatasetLookupResponse, type DatasetOptionsQuery, type DatasetOptionsResponse, NotFoundError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DatasetRepository, type FieldDatasetSource } from '../data/dataset.repository.js';

/**
 * What a person filling a form asks of a field fed by a dataset. The question is always about a field (never about a
 * dataset by id), and only the field's own column comes back: a spreadsheet may hold more than the form should show.
 */
@Injectable()
export class DatasetOptionsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DatasetRepository) private readonly datasets: DatasetRepository,
  ) {}

  options(fieldId: string, query: DatasetOptionsQuery): Promise<DatasetOptionsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const source = await this.sourceOf(tx, fieldId);
      return { values: await this.datasets.options(tx, this.tenantId, source.datasetId, source.column, query.q, query.limit) };
    });
  }

  /** The value of the field's column in the row with that key (e.g. the name for an ID number typed in another field). */
  lookup(fieldId: string, key: string): Promise<DatasetLookupResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const source = await this.sourceOf(tx, fieldId);
      return { value: await this.datasets.lookup(tx, this.tenantId, source.datasetId, key, source.column) };
    });
  }

  private async sourceOf(tx: TenantTransaction, fieldId: string): Promise<FieldDatasetSource> {
    const source = await this.datasets.sourceOfField(tx, this.tenantId, fieldId);
    if (source === null) throw new NotFoundError();
    return source;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
