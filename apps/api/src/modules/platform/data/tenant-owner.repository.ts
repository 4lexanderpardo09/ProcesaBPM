import { Injectable } from '@nestjs/common';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface OwnerIdentity {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** The identity functions are `SECURITY DEFINER`: `invite_user` and the token function need a tenant in the transaction scope. */
@Injectable()
export class TenantOwnerRepository {
  async findUserStatus(tx: PlatformTransaction, email: string): Promise<string | undefined> {
    const [row] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM auth_find_user_by_email(${email})`;
    return row?.status;
  }

  async inviteUser(tx: PlatformTransaction, owner: OwnerIdentity): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT invite_user(${owner.email}, ${owner.firstName}, ${owner.lastName})::text AS id`;
    return row!.id;
  }

  async createOwnerMembership(tx: PlatformTransaction, owner: { tenantId: string; userId: string; roleId: string; companyId: string }): Promise<void> {
    await tx.membership.create({
      data: { tenantId: owner.tenantId, userId: owner.userId, roleId: owner.roleId, status: 'INVITED', isOwner: true },
    });
    await tx.membershipCompany.create({ data: { tenantId: owner.tenantId, userId: owner.userId, companyId: owner.companyId } });
  }

  /** The membership must exist first: the function ties the token to the tenant of the scope. */
  async issueInvitationToken(tx: PlatformTransaction, token: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await tx.$queryRaw`
      SELECT auth_issue_user_token(${token.userId}::uuid, 'INVITATION'::user_token_type, ${token.tokenHash},
                                   ${token.expiresAt}::timestamptz, NULL::jsonb)::text AS id`;
  }
}
