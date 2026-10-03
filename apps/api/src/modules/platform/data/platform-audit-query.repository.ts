import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { ListPlatformAuditQuery, Page, PlatformAuditEntryResponse } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

@Injectable()
export class PlatformAuditQueryRepository {
  async list(tx: PlatformTransaction, query: ListPlatformAuditQuery): Promise<Page<PlatformAuditEntryResponse>> {
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.tenantId ? { targetTenantId: query.tenantId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.platformAuditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.platformAuditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        action: row.action,
        targetTenantId: row.targetTenantId,
        data: row.data,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
