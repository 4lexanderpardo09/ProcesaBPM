import { Injectable } from '@nestjs/common';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface OpenedSupportSession {
  readonly grantId: string;
  readonly sessionId: string;
  readonly grantExpiresAt: Date;
}

@Injectable()
export class SupportSessionRepository {
  /** `undefined` when the tenant has no grant in force. The function checks the administrator and the platform session, and locks the grant. */
  async open(tx: PlatformTransaction, tenantId: string, administratorId: string, platformSessionId: string): Promise<OpenedSupportSession | undefined> {
    const [row] = await tx.$queryRaw<Array<{ out_grant_id: string; out_session_id: string; out_expires_at: Date }>>`
      SELECT out_grant_id::text AS out_grant_id, out_session_id::text AS out_session_id, out_expires_at
      FROM platform_open_support_session(${tenantId}::uuid, ${administratorId}::uuid, ${platformSessionId}::uuid)`;
    return row === undefined ? undefined : { grantId: row.out_grant_id, sessionId: row.out_session_id, grantExpiresAt: row.out_expires_at };
  }

  /** Whether an open visit of the tenant was closed. */
  async close(tx: PlatformTransaction, tenantId: string, sessionId: string, at: Date): Promise<boolean> {
    const { count } = await tx.supportSession.updateMany({ where: { tenantId, id: sessionId, closedAt: null }, data: { closedAt: at } });
    return count > 0;
  }
}
