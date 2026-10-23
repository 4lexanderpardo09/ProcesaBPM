import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** How many of the person's latest tickets are looked at: enough to find a handful of different subcategories. */
const LOOKED_AT = 100;

/** The subcategories a person opened tickets of lately, the most recent first, each once. */
@Injectable()
export class RecentSubcategoriesRepository {
  async of(tx: TenantTransaction, tenantId: string, userId: string): Promise<string[]> {
    const tickets = await tx.ticket.findMany({ where: { tenantId, creatorId: userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: LOOKED_AT, select: { subcategoryId: true } });
    return [...new Set(tickets.map((ticket) => ticket.subcategoryId))];
  }
}
