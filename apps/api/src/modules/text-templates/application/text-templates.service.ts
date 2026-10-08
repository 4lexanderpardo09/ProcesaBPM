import { Inject, Injectable } from '@nestjs/common';
import { type CreateTextTemplateRequest, NotFoundError, type SetTextTemplateSharesRequest, type TextTemplateResponse, type UpdateTextTemplateRequest } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TextTemplateRepository, type TextTemplateRow } from '../data/text-template.repository.js';

const toResponse = (row: TextTemplateRow, userId: string): TextTemplateResponse => ({
  id: row.id,
  title: row.title,
  bodyHtml: row.bodyHtml,
  isOwner: row.ownerId === userId,
  ownerId: row.ownerId,
  ownerName: `${row.ownerFirstName} ${row.ownerLastName}`.trim(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Personal text templates: the owner edits and shares them; a shared template is read-only for everyone else. */
@Injectable()
export class TextTemplatesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TextTemplateRepository) private readonly templates: TextTemplateRepository,
  ) {}

  list(): Promise<TextTemplateResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => (await this.templates.list(tx, this.tenantId, this.userId)).map((row) => toResponse(row, this.userId)));
  }

  async get(id: string): Promise<TextTemplateResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const row = await this.templates.findReadable(tx, this.tenantId, this.userId, id);
      if (row === null) throw new NotFoundError();
      return toResponse(row, this.userId);
    });
  }

  async create(request: CreateTextTemplateRequest): Promise<TextTemplateResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.templates.create(tx, this.tenantId, this.userId, request), this.userId));
  }

  async update(id: string, request: UpdateTextTemplateRequest): Promise<TextTemplateResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const row = await this.templates.update(tx, this.tenantId, this.userId, id, request);
      if (row === null) throw new NotFoundError();
      return toResponse(row, this.userId);
    });
  }

  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.templates.remove(tx, this.tenantId, this.userId, id))) throw new NotFoundError();
    });
  }

  shares(id: string): Promise<string[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.templates.findOwn(tx, this.tenantId, this.userId, id)) === null) throw new NotFoundError();
      return this.templates.listShares(tx, this.tenantId, id);
    });
  }

  setShares(id: string, request: SetTextTemplateSharesRequest): Promise<string[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.templates.findOwn(tx, this.tenantId, this.userId, id)) === null) throw new NotFoundError();
      // The owner is never shared with themselves; only members of the tenant are kept.
      const candidates = request.userIds.filter((userId) => userId !== this.userId);
      const members = await this.templates.memberIdsAmong(tx, this.tenantId, candidates);
      await this.templates.replaceShares(tx, this.tenantId, id, members);
      return this.templates.listShares(tx, this.tenantId, id);
    });
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }

  private get userId(): string {
    return this.context.require().userId;
  }
}
