import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../../../common/logging/request-context.js';
import type { Prisma } from '@procesabpm/db';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface PlatformAuditEntry {
  readonly actorUserId: string;
  readonly action: string;
  readonly targetTenantId: string;
  readonly data?: Prisma.InputJsonObject;
}

/** Append-only trail of what platform administrators do; it keeps no foreign keys, so it outlives the tenant. */
@Injectable()
export class PlatformAuditRepository {
  constructor(@Inject(RequestContext) private readonly requestContext: RequestContext) {}

  async record(tx: PlatformTransaction, entry: PlatformAuditEntry): Promise<void> {
    await tx.platformAuditLog.create({
      data: { actorUserId: entry.actorUserId, action: entry.action, targetTenantId: entry.targetTenantId, data: entry.data ?? {}, ipAddress: this.requestContext.current()?.ipAddress ?? null },
    });
  }
}
