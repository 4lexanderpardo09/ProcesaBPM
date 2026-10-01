import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';

@Injectable()
export class PlatformAccessRepository {
  /**
   * Still a platform administrator, account active, and the session live and opened for the platform.
   * Needs `app.user_id` = `userId`: the API role cannot read `platform_admins` itself.
   */
  async hasAccess(tx: AuthTransaction, userId: string, sessionId: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT auth_platform_access(${userId}::uuid, ${sessionId}::uuid) AS ok`;
    return row?.ok === true;
  }
}
