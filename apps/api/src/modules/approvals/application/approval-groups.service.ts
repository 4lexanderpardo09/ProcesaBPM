import { Inject, Injectable } from '@nestjs/common';
import {
  type ApprovalGroupResponse,
  type ApprovalGroupsQuery,
  type ApprovalMembersResponse,
  type ApproversResponse,
  type CreateApprovalGroupRequest,
  NotFoundError,
  type Page,
  type RenameApprovalGroupRequest,
  type ReplaceApprovalMembersRequest,
  type ReplaceApproversRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { ApprovalGroupRepository, type ApprovalGroupRow } from '../data/approval-group.repository.js';

const toResponse = (row: ApprovalGroupRow): ApprovalGroupResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

/**
 * Approval groups ("X approves Y, Z"). The database enforces that a person belongs to one group per
 * (type, company): a second one answers 409, and the group's type and company are copied to its
 * member rows and cannot change while it has members.
 */
@Injectable()
export class ApprovalGroupsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(ApprovalGroupRepository) private readonly repository: ApprovalGroupRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(query: ApprovalGroupsQuery): Promise<Page<ApprovalGroupResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<ApprovalGroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  /** A type or company of another tenant is refused by the composite foreign keys (422). */
  create(request: CreateApprovalGroupRequest): Promise<ApprovalGroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const created = await this.repository.create(tx, this.tenantId, { typeId: request.typeId, name: request.name, ...compact({ companyId: request.companyId }) });
      await this.audit.record(tx, { action: 'approval_group.created', subjectType: 'ApprovalGroup', subjectId: created.id, after: { name: created.name, typeId: request.typeId, companyId: request.companyId ?? null } });
      return toResponse(created);
    });
  }

  rename(id: string, request: RenameApprovalGroupRequest): Promise<ApprovalGroupResponse> {
    return this.change(id, 'approval_group.updated', { name: request.name });
  }

  activate(id: string): Promise<ApprovalGroupResponse> {
    return this.change(id, 'approval_group.activated', { isActive: true });
  }

  deactivate(id: string): Promise<ApprovalGroupResponse> {
    return this.change(id, 'approval_group.deactivated', { isActive: false });
  }

  approvers(id: string): Promise<ApproversResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return { approvers: await this.repository.findApprovers(tx, this.tenantId, id) };
    });
  }

  /** Reorders (or replaces) the approvers in one operation: the first of the list is the primary. */
  replaceApprovers(id: string, request: ReplaceApproversRequest): Promise<ApproversResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      const before = await this.repository.findApprovers(tx, this.tenantId, id);
      await this.repository.replaceApprovers(tx, this.tenantId, id, request.userIds);
      const approvers = await this.repository.findApprovers(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'approval_group.approvers_replaced', subjectType: 'ApprovalGroup', subjectId: id, before: { approvers: before }, after: { approvers } });
      return { approvers };
    });
  }

  members(id: string): Promise<ApprovalMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  addMember(id: string, userId: string): Promise<ApprovalMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const group = await this.require(tx, id);
      await this.repository.addMember(tx, this.tenantId, group, userId);
      await this.audit.record(tx, { action: 'approval_group.member_added', subjectType: 'ApprovalGroup', subjectId: id, after: { userId } });
      return { userIds: await this.repository.findMemberIds(tx, this.tenantId, id) };
    });
  }

  removeMember(id: string, userId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      if (!(await this.repository.removeMember(tx, this.tenantId, id, userId))) throw new NotFoundError();
      await this.audit.record(tx, { action: 'approval_group.member_removed', subjectType: 'ApprovalGroup', subjectId: id, before: { userId } });
    });
  }

  replaceMembers(id: string, request: ReplaceApprovalMembersRequest): Promise<ApprovalMembersResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const group = await this.require(tx, id);
      const before = await this.repository.findMemberIds(tx, this.tenantId, id);
      await this.repository.replaceMembers(tx, this.tenantId, group, request.userIds);
      const userIds = await this.repository.findMemberIds(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'approval_group.members_replaced', subjectType: 'ApprovalGroup', subjectId: id, before: { userIds: before }, after: { userIds } });
      return { userIds };
    });
  }

  private change(id: string, action: 'approval_group.updated' | 'approval_group.activated' | 'approval_group.deactivated', data: { name?: string; isActive?: boolean }): Promise<ApprovalGroupResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      const updated = await this.require(tx, id);
      await this.audit.record(tx, { action, subjectType: 'ApprovalGroup', subjectId: id, before: { name: before.name, isActive: before.isActive }, after: { name: updated.name, isActive: updated.isActive } });
      return toResponse(updated);
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<ApprovalGroupRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
