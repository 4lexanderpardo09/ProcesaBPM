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
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { GroupRepository, type GroupRow } from '../data/group.repository.js';

const toResponse = (row: GroupRow): GroupResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Groups of members ("perfiles"): used to assign work and to observe workflows. */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(GroupRepository) private readonly repository: GroupRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
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
    return this.runner.withTenantTransaction(async (tx) => {
      const created = await this.repository.create(tx, this.tenantId, request.name);
      await this.audit.record(tx, { action: 'group.created', subjectType: 'Group', subjectId: created.id, after: { name: created.name } });
      return toResponse(created);
    });
  }

  rename(id: string, request: GroupRequest): Promise<GroupResponse> {
    return this.change(id, 'group.updated', { name: request.name });
  }

  activate(id: string): Promise<GroupResponse> {
    return this.change(id, 'group.activated', { isActive: true });
  }

  deactivate(id: string): Promise<GroupResponse> {
    return this.change(id, 'group.deactivated', { isActive: false });
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
      await this.audit.record(tx, { action: 'group.member_added', subjectType: 'Group', subjectId: id, after: { userId } });
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  removeMember(id: string, userId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      if (!(await this.repository.removeMember(tx, this.tenantId, id, userId))) throw new NotFoundError();
      await this.audit.record(tx, { action: 'group.member_removed', subjectType: 'Group', subjectId: id, before: { userId } });
    });
  }

  replaceMembers(id: string, request: ReplaceGroupMembersRequest): Promise<GroupMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      const before = await this.repository.findMemberIds(tx, this.tenantId, id);
      await this.repository.replaceMembers(tx, this.tenantId, id, request.userIds);
      const after = await this.repository.findMemberIds(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'group.members_replaced', subjectType: 'Group', subjectId: id, before: { userIds: before }, after: { userIds: after } });
      return { userIds: after };
    });
  }

  private change(id: string, action: 'group.updated' | 'group.activated' | 'group.deactivated', data: { name?: string; isActive?: boolean }): Promise<GroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      const updated = await this.require(tx, id);
      await this.audit.record(tx, { action, subjectType: 'Group', subjectId: id, before: { name: before.name, isActive: before.isActive }, after: { name: updated.name, isActive: updated.isActive } });
      return toResponse(updated);
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
