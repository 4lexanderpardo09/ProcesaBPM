import { Inject, Injectable } from '@nestjs/common';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import {
  type MemberResponse,
  type MembersQuery,
  NotFoundError,
  type Page,
  PermissionDeniedError,
  type UpdateMemberRequest,
} from '@procesabpm/shared';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { type MemberRow, MemberRepository } from '../data/member.repository.js';
import { assertCanDeactivate, statusAfterActivation } from '../domain/member-policy.js';

/** What the trail keeps of a membership: where the person sits, not who they are. */
const summaryOf = (row: MemberRow) => ({
  status: row.status,
  roleId: row.roleId,
  positionId: row.positionId,
  departmentId: row.departmentId,
  siteId: row.siteId,
  companyIds: row.companies.map((company) => company.companyId),
});

export const toMemberResponse = (row: MemberRow): MemberResponse => ({
  userId: row.userId,
  email: row.user.email,
  firstName: row.user.firstName,
  lastName: row.user.lastName,
  status: row.status,
  isOwner: row.isOwner,
  roleId: row.roleId,
  positionId: row.positionId,
  departmentId: row.departmentId,
  siteId: row.siteId,
  companyIds: row.companies.map((company) => company.companyId),
  joinedAt: row.joinedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The owner and administrator rules (the owner keeps an admin role and an active membership, only an
 * administrator grants admin roles) are enforced by the database; their violations reach the client as
 * typed errors (403 / 422), not as 500.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(MemberRepository) private readonly repository: MemberRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(query: MembersQuery): Promise<Page<MemberResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toMemberResponse);
    });
  }

  get(userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => toMemberResponse(await this.require(tx, userId)));
  }

  update(ability: AppAbility, userId: string, request: UpdateMemberRequest): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.require(tx, userId);
      if (request.roleId !== undefined && request.roleId !== member.roleId) await this.assertMayLower(tx, ability, member);
      const { companyIds, ...fields } = compact(request);
      if (Object.keys(fields).length > 0) await this.repository.update(tx, this.tenantId, userId, fields);
      if (companyIds !== undefined) await this.repository.replaceCompanies(tx, this.tenantId, userId, companyIds);
      const updated = await this.require(tx, userId);
      await this.audit.record(tx, { action: 'member.updated', subjectType: 'Membership', subjectId: userId, before: summaryOf(member), after: summaryOf(updated) });
      return toMemberResponse(updated);
    });
  }

  activate(userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.require(tx, userId);
      await this.repository.update(tx, this.tenantId, userId, { status: statusAfterActivation(member) });
      const updated = await this.require(tx, userId);
      await this.audit.record(tx, { action: 'member.reactivated', subjectType: 'Membership', subjectId: userId, before: { status: member.status }, after: { status: updated.status } });
      return toMemberResponse(updated);
    });
  }

  deactivate(ability: AppAbility, actingUserId: string, userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.require(tx, userId);
      assertCanDeactivate(member, actingUserId, userId);
      await this.assertMayLower(tx, ability, member);
      await this.repository.update(tx, this.tenantId, userId, { status: 'INACTIVE' });
      await this.audit.record(tx, { action: 'member.deactivated', subjectType: 'Membership', subjectId: userId, before: { status: member.status }, after: { status: 'INACTIVE' } });
      return toMemberResponse(await this.require(tx, userId));
    });
  }

  /** Taking an administrator off their role, or deactivating them, needs full access (the database backs this up). */
  private async assertMayLower(tx: TenantTransaction, ability: AppAbility, member: MemberRow): Promise<void> {
    const targetHasFullAccess = member.isOwner || (await this.repository.roleGrantsFullAccess(tx, this.tenantId, member.roleId));
    if (targetHasFullAccess && !ability.can('manage', 'all')) throw new PermissionDeniedError('Only an administrator can lower or deactivate an administrator');
  }

  private async require(tx: TenantTransaction, userId: string): Promise<MemberRow> {
    const member = await this.repository.findById(tx, this.tenantId, userId);
    if (member === null) throw new NotFoundError();
    return member;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
