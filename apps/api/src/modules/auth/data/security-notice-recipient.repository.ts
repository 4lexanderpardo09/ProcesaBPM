import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

export interface SecurityNoticeRecipient {
  readonly email: string;
  readonly firstName: string;
  readonly timeZone: string | null;
  /** From the session in the notice, when there is one and it belongs to the user. */
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** The owner who is told about a change to one of the organization's members. */
export interface MemberNoticeRecipient {
  readonly email: string;
  readonly firstName: string;
  readonly timeZone: string | null;
  readonly organization: string;
  readonly memberName: string;
}

/**
 * The worker's read of who gets a security notice (`worker_security_notice_recipient` and
 * `worker_member_security_notice_recipient`, docs/base-de-datos.md §8.28 and §8.29).
 */
@Injectable()
export class SecurityNoticeRecipientRepository {
  /** `undefined` for a disabled or deleted account: nothing is sent. */
  async find(tx: CrossTenantTransaction, userId: string, sessionId: string | null): Promise<SecurityNoticeRecipient | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_email: string; out_first_name: string; out_time_zone: string | null; out_ip_address: string | null; out_user_agent: string | null }>>`
      SELECT out_email, out_first_name, out_time_zone, out_ip_address, out_user_agent
      FROM worker_security_notice_recipient(${userId}::uuid, ${sessionId}::uuid)`;
    return row === undefined
      ? undefined
      : { email: row.out_email, firstName: row.out_first_name, timeZone: row.out_time_zone, ipAddress: row.out_ip_address, userAgent: row.out_user_agent };
  }

  /** `undefined` unless the recipient is still an active owner of the organization and the member belongs to it. */
  async findOwner(tx: CrossTenantTransaction, ownerId: string, tenantId: string, memberId: string): Promise<MemberNoticeRecipient | undefined> {
    const [row] = await tx.$queryRaw<
      Array<{ out_email: string; out_first_name: string; out_time_zone: string | null; out_organization: string; out_member_first_name: string; out_member_last_name: string }>
    >`
      SELECT out_email, out_first_name, out_time_zone, out_organization, out_member_first_name, out_member_last_name
      FROM worker_member_security_notice_recipient(${ownerId}::uuid, ${tenantId}::uuid, ${memberId}::uuid)`;
    return row === undefined
      ? undefined
      : {
          email: row.out_email,
          firstName: row.out_first_name,
          timeZone: row.out_time_zone,
          organization: row.out_organization,
          memberName: `${row.out_member_first_name} ${row.out_member_last_name}`,
        };
  }
}
