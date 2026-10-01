import { Inject, Injectable } from '@nestjs/common';
import {
  type CompanyResponse,
  type CreateCompanyRequest,
  InvalidReferenceError,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
  type UpdateCompanyRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type CompanyRow, type CompanyWrite, CompanyRepository } from '../data/company.repository.js';
import { resolveCompanyRegion } from '../domain/company-defaults.js';

const toResponse = (row: CompanyRow): CompanyResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CompanyRepository) private readonly repository: CompanyRepository,
  ) {}

  list(query: PageQuery): Promise<Page<CompanyResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<CompanyResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: CreateCompanyRequest): Promise<CompanyResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const country = await this.repository.findCountry(tx, request.countryCode);
      if (country === null) throw new InvalidReferenceError(`Unknown country ${request.countryCode}`);
      const region = resolveCompanyRegion(request, country);
      const created = await this.repository.create(tx, this.tenantId, {
        name: request.name,
        countryCode: request.countryCode,
        ...region,
        ...compact({ taxId: request.taxId, calendarId: request.calendarId }),
      });
      return toResponse(created);
    });
  }

  update(id: string, request: UpdateCompanyRequest): Promise<CompanyResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const current = await this.require(tx, id);
      const data = await this.withDerivedRegion(tx, request, current);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  activate(id: string): Promise<CompanyResponse> {
    return this.changeActive(id, true);
  }

  deactivate(id: string): Promise<CompanyResponse> {
    return this.changeActive(id, false);
  }

  makeDefault(id: string): Promise<CompanyResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const company = await this.require(tx, id);
      if (!company.isActive) throw new InvalidStateError('An inactive company cannot be the default');
      if (!company.isDefault && !(await this.repository.makeDefault(tx, this.tenantId, id))) throw new InvalidStateError('An inactive company cannot be the default');
      return toResponse(await this.require(tx, id));
    });
  }

  private changeActive(id: string, isActive: boolean): Promise<CompanyResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const company = await this.require(tx, id);
      if (!isActive && company.isDefault) throw new InvalidStateError('The default company cannot be deactivated: choose another default first');
      if (!(await this.repository.setActive(tx, this.tenantId, id, isActive))) throw new InvalidStateError('The default company cannot be deactivated: choose another default first');
      return toResponse(await this.require(tx, id));
    });
  }

  /** Changing the country without choosing a currency or time zone re-derives them from the new country. */
  private async withDerivedRegion(tx: TenantTransaction, request: UpdateCompanyRequest, current: CompanyRow): Promise<CompanyWrite> {
    const fields = compact(request);
    if (fields.countryCode === undefined) return fields;
    // Only a real change of country re-derives; repeating the current one keeps the chosen values.
    if (current.countryCode === fields.countryCode) return fields;
    const country = await this.repository.findCountry(tx, fields.countryCode);
    if (country === null) throw new InvalidReferenceError(`Unknown country ${fields.countryCode}`);
    return { ...fields, ...resolveCompanyRegion(fields, country) };
  }

  private async require(tx: TenantTransaction, id: string): Promise<CompanyRow> {
    const company = await this.repository.findById(tx, this.tenantId, id);
    if (company === null) throw new NotFoundError();
    return company;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
