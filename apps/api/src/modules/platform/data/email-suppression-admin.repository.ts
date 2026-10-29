import { Injectable } from '@nestjs/common';
import type { EmailSuppressionSummary, ListEmailSuppressionsQuery, Page } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

const SELECT = { id: true, email: true, reason: true, detail: true, events: true, createdAt: true, lastEventAt: true } as const;

type Row = { id: string; email: string; reason: EmailSuppressionSummary['reason']; detail: string | null; events: number; createdAt: Date; lastEventAt: Date };

const toSummary = (row: Row): EmailSuppressionSummary => ({
  id: row.id,
  email: row.email,
  reason: row.reason,
  detail: row.detail,
  events: row.events,
  createdAt: row.createdAt.toISOString(),
  lastEventAt: row.lastEventAt.toISOString(),
});

/** The addresses the worker does not write to (§8.34), most recent first. Only the platform login reads or removes them. */
@Injectable()
export class EmailSuppressionAdminRepository {
  async list(tx: PlatformTransaction, query: ListEmailSuppressionsQuery): Promise<Page<EmailSuppressionSummary>> {
    const where = {
      ...(query.reason === undefined ? {} : { reason: query.reason }),
      ...(query.search === undefined ? {} : { email: { contains: query.search.toLowerCase() } }),
    };
    const [rows, total] = await Promise.all([
      tx.emailSuppression.findMany({ where, select: SELECT, orderBy: [{ lastEventAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.emailSuppression.count({ where }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  /** The removed row (for the audit), or `undefined` when there is none. */
  async remove(tx: PlatformTransaction, id: string): Promise<EmailSuppressionSummary | undefined> {
    const row = await tx.emailSuppression.findUnique({ where: { id }, select: SELECT });
    if (row === null) return undefined;
    await tx.emailSuppression.delete({ where: { id } });
    return toSummary(row);
  }
}
