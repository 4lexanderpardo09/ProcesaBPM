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
  type UpdateMemberRequest,
} from '@procesabpm/shared';
import { type MemberRow, MemberRepository } from '../data/member.repository.js';
import { assertCanDeactivate, statusAfterActivation } from '../domain/member-policy.js';

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

  update(userId: string, request: UpdateMemberRequest): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, userId);
      const { companyIds, ...fields } = compact(request);
      if (Object.keys(fields).length > 0) await this.repository.update(tx, this.tenantId, userId, fields);
      if (companyIds !== undefined) await this.repository.replaceCompanies(tx, this.tenantId, userId, companyIds);
      return toMemberResponse(await this.require(tx, userId));
    });
  }

  activate(userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.require(tx, userId);
      await this.repository.update(tx, this.tenantId, userId, { status: statusAfterActivation(member) });
      return toMemberResponse(await this.require(tx, userId));
    });
  }

  deactivate(actingUserId: string, userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.require(tx, userId);
      assertCanDeactivate(member, actingUserId, userId);
      await this.repository.update(tx, this.tenantId, userId, { status: 'INACTIVE' });
      return toMemberResponse(await this.require(tx, userId));
    });
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
