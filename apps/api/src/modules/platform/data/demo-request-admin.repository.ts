import { Injectable } from '@nestjs/common';
import type { DemoRequestSummary, ListDemoRequestsQuery, MarkDemoRequest, Page } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

const SELECT = {
  id: true,
  fullName: true,
  company: true,
  email: true,
  teamSize: true,
  process: true,
  status: true,
  handledAt: true,
  createdAt: true,
  handledBy: { select: { firstName: true, lastName: true } },
} as const;

type Row = {
  id: string;
  fullName: string;
  company: string;
  email: string;
  teamSize: DemoRequestSummary['teamSize'];
  process: string | null;
  status: DemoRequestSummary['status'];
  handledAt: Date | null;
  createdAt: Date;
  handledBy: { firstName: string; lastName: string } | null;
};

const toSummary = (row: Row): DemoRequestSummary => ({
  id: row.id,
  fullName: row.fullName,
  company: row.company,
  email: row.email,
  teamSize: row.teamSize,
  process: row.process,
  status: row.status,
  handledBy: row.handledBy === null ? null : `${row.handledBy.firstName} ${row.handledBy.lastName}`.trim(),
  handledAt: row.handledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** The website's demo requests, newest first. Only the platform login reads or changes them (§8.33). */
@Injectable()
export class DemoRequestAdminRepository {
  async list(tx: PlatformTransaction, query: ListDemoRequestsQuery): Promise<Page<DemoRequestSummary>> {
    const where = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lt: new Date(query.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.demoRequest.findMany({ where, select: SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.demoRequest.count({ where }),
    ]);
    return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
  }

  /** `undefined` when there is no such request. Marking again moves the date and the person to the latest mark. */
  async mark(tx: PlatformTransaction, id: string, adminUserId: string, change: MarkDemoRequest): Promise<DemoRequestSummary | undefined> {
    const { count } = await tx.demoRequest.updateMany({ where: { id }, data: { status: change.status, handledById: adminUserId, handledAt: new Date() } });
    if (count === 0) return undefined;
    const row = await tx.demoRequest.findUniqueOrThrow({ where: { id }, select: SELECT });
    return toSummary(row);
  }
}
