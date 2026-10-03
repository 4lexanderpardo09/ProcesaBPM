import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

@Injectable()
export class SupportSessionRepository {
  /** `auth_verify_support_session` also closes the visit when it is no longer valid. */
  async isValid(tx: TenantTransaction, claims: { tenantId: string; sessionId: string; grantId: string; administratorId: string }): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT auth_verify_support_session(${claims.tenantId}::uuid, ${claims.sessionId}::uuid, ${claims.grantId}::uuid, ${claims.administratorId}::uuid) AS ok`;
    return row?.ok === true;
  }
}
