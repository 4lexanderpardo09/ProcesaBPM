import { Inject, Injectable } from '@nestjs/common';
import { type CreateTagRequest, NotFoundError, type TagResponse, type UpdateTagRequest } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TagRepository, type TagRow } from '../data/tag.repository.js';

const toResponse = (row: TagRow): TagResponse => ({ id: row.id, name: row.name, color: row.color });

/** Personal tags: every member manages their own, and nobody sees or touches anyone else's. */
@Injectable()
export class TagsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TagRepository) private readonly tags: TagRepository,
  ) {}

  list(): Promise<TagResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => (await this.tags.list(tx, this.tenantId, this.userId)).map(toResponse));
  }

  create(request: CreateTagRequest): Promise<TagResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.tags.create(tx, this.tenantId, this.userId, request)));
  }

  async update(id: string, request: UpdateTagRequest): Promise<TagResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const row = await this.tags.update(tx, this.tenantId, this.userId, id, request);
      if (row === null) throw new NotFoundError();
      return toResponse(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.tags.remove(tx, this.tenantId, this.userId, id))) throw new NotFoundError();
    });
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }

  private get userId(): string {
    return this.context.require().userId;
  }
}
