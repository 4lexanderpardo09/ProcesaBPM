import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface NamedRecordRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

const SELECT = { id: true, name: true, isActive: true, createdAt: true } as const;

type Where = ReturnType<typeof nameFilter> & { tenantId: string };
type KeyWhere = { tenantId: string; id: string };

/** The part of a Prisma delegate that records with a unique `name` and an `isActive` flag have in common. */
export interface NamedRecordDelegate {
  findMany(args: { where: Where; select: typeof SELECT; orderBy: { name: 'asc' }; skip: number; take: number }): Promise<NamedRecordRow[]>;
  count(args: { where: Where }): Promise<number>;
  findFirst(args: { where: KeyWhere; select: typeof SELECT }): Promise<NamedRecordRow | null>;
  create(args: { data: { tenantId: string; name: string }; select: typeof SELECT }): Promise<NamedRecordRow>;
  updateMany(args: { where: KeyWhere; data: { name?: string; isActive?: boolean } }): Promise<{ count: number }>;
}

/** Departments and positions: a name, unique per tenant, that can be deactivated. */
export abstract class NamedRecordRepository {
  protected abstract delegate(tx: TenantTransaction): NamedRecordDelegate;

  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: NamedRecordRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const delegate = this.delegate(tx);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      delegate.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<NamedRecordRow | null> {
    return this.delegate(tx).findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, name: string): Promise<NamedRecordRow> {
    return this.delegate(tx).create({ data: { tenantId, name }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await this.delegate(tx).updateMany({ where: { tenantId, id }, data });
  }
}
