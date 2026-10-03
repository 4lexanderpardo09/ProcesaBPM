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

/** The worker's read of who gets a security notice (`worker_security_notice_recipient`, docs/base-de-datos.md §8.27). */
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
}
