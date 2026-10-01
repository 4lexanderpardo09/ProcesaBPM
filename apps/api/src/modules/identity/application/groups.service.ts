import { Inject, Injectable } from '@nestjs/common';
import {
  type GroupMembersResponse,
  type GroupRequest,
  type GroupResponse,
  NotFoundError,
  type Page,
  type PageQuery,
  type ReplaceGroupMembersRequest,
} from '@procesabpm/shared';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { GroupRepository, type GroupRow } from '../data/group.repository.js';

const toResponse = (row: GroupRow): GroupResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Groups of members ("perfiles"): used to assign work and to observe workflows. */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(GroupRepository) private readonly repository: GroupRepository,
  ) {}

  list(query: PageQuery): Promise<Page<GroupResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<GroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: GroupRequest): Promise<GroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.repository.create(tx, this.tenantId, request.name)));
  }

  rename(id: string, request: GroupRequest): Promise<GroupResponse> {
    return this.change(id, { name: request.name });
  }

  activate(id: string): Promise<GroupResponse> {
    return this.change(id, { isActive: true });
  }

  deactivate(id: string): Promise<GroupResponse> {
    return this.change(id, { isActive: false });
  }

  members(id: string): Promise<GroupMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  /** A user who is not a member of the tenant is refused by the composite foreign key (422); a repeat is a 409. */
  addMember(id: string, userId: string): Promise<GroupMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.addMember(tx, this.tenantId, id, userId);
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  removeMember(id: string, userId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      if (!(await this.repository.removeMember(tx, this.tenantId, id, userId))) throw new NotFoundError();
    });
  }

  replaceMembers(id: string, request: ReplaceGroupMembersRequest): Promise<GroupMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.replaceMembers(tx, this.tenantId, id, request.userIds);
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  private change(id: string, data: { name?: string; isActive?: boolean }): Promise<GroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      return toResponse(await this.require(tx, id));
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<GroupRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
