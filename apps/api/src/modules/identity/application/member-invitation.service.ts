import { Inject, Injectable } from '@nestjs/common';
import { type InviteMemberRequest, type MemberResponse, NotFoundError } from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { MemberRepository } from '../data/member.repository.js';
import { assertInvitationPending, INVITATION_EMAIL_EVENT, MEMBER_INVITATION_TTL_MS } from '../domain/member-policy.js';
import { toMemberResponse } from './members.service.js';

/**
 * Invites people into the tenant: identity without a password (or the existing one, untouched), an
 * INVITED membership, its companies and a one-time token. The clear token only travels in the platform
 * outbox payload (read by the worker, erased when the event ends); the database keeps its hash.
 */
@Injectable()
export class MemberInvitationService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(MemberRepository) private readonly members: MemberRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** A person who is already a member answers 409 (the membership key); a foreign role or company, 422. */
  invite(request: InviteMemberRequest): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const userId = await this.members.inviteUser(tx, request);
      await this.members.create(tx, this.tenantId, {
        userId,
        roleId: request.roleId,
        ...compact({ positionId: request.positionId, departmentId: request.departmentId, siteId: request.siteId }),
      });
      await this.members.replaceCompanies(tx, this.tenantId, userId, request.companyIds);
      await this.sendInvitation(tx, userId);
      // Until the person accepts, the names are the ones sent: the stored ones may come from another organization.
      return { ...toMemberResponse(await this.requireMember(tx, userId)), firstName: request.firstName, lastName: request.lastName };
    });
  }

  /** Issues a new link; the previous ones keep working until they expire. */
  resend(userId: string): Promise<MemberResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const member = await this.requireMember(tx, userId);
      assertInvitationPending(member);
      await this.sendInvitation(tx, userId);
      return toMemberResponse(member);
    });
  }

  private async sendInvitation(tx: TenantTransaction, userId: string): Promise<void> {
    const member = await this.requireMember(tx, userId);
    const tenantName = (await this.members.findTenantName(tx, this.tenantId)) ?? '';
    const token = generateOpaqueToken();
    const expiresAt = new Date(this.clock.now().getTime() + MEMBER_INVITATION_TTL_MS);
    await this.members.issueInvitationToken(tx, { userId, tokenHash: sha256Hex(token), expiresAt });
    await this.outbox.enqueue(tx, INVITATION_EMAIL_EVENT, {
      userId,
      email: member.user.email,
      tenantId: this.tenantId,
      tenantName,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  }

  private async requireMember(tx: TenantTransaction, userId: string) {
    const member = await this.members.findById(tx, this.tenantId, userId);
    if (member === null) throw new NotFoundError();
    return member;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
