import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateErrorSubtypeRequest,
  type CreateErrorTypeRequest,
  type ErrorSubtypeResponse,
  type ErrorTypeResponse,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
  type UpdateErrorSubtypeRequest,
  type UpdateErrorTypeRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ErrorTypeRepository, type ErrorSubtypeRow, type ErrorSubtypeWrite, type ErrorTypeRow, type ErrorTypeWrite } from '../data/error-type.repository.js';

/** The catalog of error types and subtypes. They are never deleted (reports and reopenings point at them): they are deactivated. */
@Injectable()
export class ErrorTypesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(ErrorTypeRepository) private readonly repository: ErrorTypeRepository,
  ) {}

  list(query: PageQuery): Promise<Page<ErrorTypeResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, (row) => row);
    });
  }

  get(id: string): Promise<ErrorTypeResponse> {
    return this.runner.withTenantTransaction((tx) => this.requireType(tx, id));
  }

  create(request: CreateErrorTypeRequest): Promise<ErrorTypeResponse> {
    return this.runner.withTenantTransaction((tx) => this.repository.create(tx, this.tenantId, { name: request.name, ...compact({ description: request.description, isProcessError: request.isProcessError, forcesClose: request.forcesClose, isReopening: request.isReopening }) }));
  }

  /** The flags are checked against the stored ones as well: changing only one of them must not leave a type that is both a reopening and forces the close. */
  update(id: string, request: UpdateErrorTypeRequest): Promise<ErrorTypeResponse> {
    return this.changeType(id, compact(request));
  }

  activate(id: string): Promise<ErrorTypeResponse> {
    return this.changeType(id, { isActive: true });
  }

  deactivate(id: string): Promise<ErrorTypeResponse> {
    return this.changeType(id, { isActive: false });
  }

  listSubtypes(errorTypeId: string, query: PageQuery): Promise<Page<ErrorSubtypeResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireType(tx, errorTypeId);
      const { rows, total } = await this.repository.listSubtypes(tx, this.tenantId, errorTypeId, query);
      return toPage(rows, total, query, (row) => row);
    });
  }

  getSubtype(errorTypeId: string, id: string): Promise<ErrorSubtypeResponse> {
    return this.runner.withTenantTransaction((tx) => this.requireSubtype(tx, errorTypeId, id));
  }

  createSubtype(errorTypeId: string, request: CreateErrorSubtypeRequest): Promise<ErrorSubtypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireType(tx, errorTypeId);
      return this.repository.createSubtype(tx, this.tenantId, errorTypeId, { name: request.name, ...compact({ description: request.description }) });
    });
  }

  updateSubtype(errorTypeId: string, id: string, request: UpdateErrorSubtypeRequest): Promise<ErrorSubtypeResponse> {
    return this.changeSubtype(errorTypeId, id, compact(request));
  }

  activateSubtype(errorTypeId: string, id: string): Promise<ErrorSubtypeResponse> {
    return this.changeSubtype(errorTypeId, id, { isActive: true });
  }

  deactivateSubtype(errorTypeId: string, id: string): Promise<ErrorSubtypeResponse> {
    return this.changeSubtype(errorTypeId, id, { isActive: false });
  }

  private changeType(id: string, data: ErrorTypeWrite): Promise<ErrorTypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const current = await this.requireType(tx, id);
      const merged = { ...current, ...data };
      if (merged.isReopening && merged.forcesClose) throw new InvalidStateError('A reopening error type cannot also force the ticket to close');
      await this.repository.update(tx, this.tenantId, id, data);
      return this.requireType(tx, id);
    });
  }

  private changeSubtype(errorTypeId: string, id: string, data: ErrorSubtypeWrite): Promise<ErrorSubtypeResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireSubtype(tx, errorTypeId, id);
      await this.repository.updateSubtype(tx, this.tenantId, errorTypeId, id, data);
      return this.requireSubtype(tx, errorTypeId, id);
    });
  }

  private async requireType(tx: TenantTransaction, id: string): Promise<ErrorTypeRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private async requireSubtype(tx: TenantTransaction, errorTypeId: string, id: string): Promise<ErrorSubtypeRow> {
    const row = await this.repository.findSubtype(tx, this.tenantId, errorTypeId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
