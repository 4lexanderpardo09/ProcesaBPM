import { Injectable } from '@nestjs/common';
import type { MembersQuery } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export type MemberStatusValue = 'INVITED' | 'ACTIVE' | 'INACTIVE';

export interface MemberRow {
  readonly userId: string;
  readonly status: MemberStatusValue;
  readonly isOwner: boolean;
  readonly roleId: string;
  readonly positionId: string | null;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  readonly joinedAt: Date | null;
  readonly createdAt: Date;
  readonly user: { readonly email: string; readonly firstName: string; readonly lastName: string };
  readonly companies: ReadonlyArray<{ readonly companyId: string }>;
}

export interface MemberWrite {
  readonly roleId?: string;
  readonly positionId?: string | null;
  readonly departmentId?: string | null;
  readonly siteId?: string | null;
  readonly status?: MemberStatusValue;
}

export interface NewMember {
  readonly userId: string;
  readonly roleId: string;
  readonly positionId?: string;
  readonly departmentId?: string;
  readonly siteId?: string;
}

const SELECT = {
  userId: true,
  status: true,
  isOwner: true,
  roleId: true,
  positionId: true,
  departmentId: true,
  siteId: true,
  joinedAt: true,
  createdAt: true,
  user: { select: { email: true, firstName: true, lastName: true } },
  companies: { select: { companyId: true } },
} as const;

/** Every query carries the tenant explicitly on top of row-level security. */
@Injectable()
export class MemberRepository {
  async list(tx: TenantTransaction, tenantId: string, query: MembersQuery): Promise<{ rows: MemberRow[]; total: number }> {
    const search = query.search;
    const where = {
      tenantId,
      ...(query.roleId === undefined ? {} : { roleId: query.roleId }),
      ...(query.positionId === undefined ? {} : { positionId: query.positionId }),
      ...(query.departmentId === undefined ? {} : { departmentId: query.departmentId }),
      ...(query.siteId === undefined ? {} : { siteId: query.siteId }),
      ...(query.status !== undefined ? { status: query.status } : query.includeInactive ? {} : { status: { not: 'INACTIVE' as const } }),
      ...(search === undefined
        ? {}
        : {
            user: {
              OR: [
                { email: { contains: search, mode: 'insensitive' as const } },
                { firstName: { contains: search, mode: 'insensitive' as const } },
                { lastName: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          }),
    };
    const [rows, total] = await Promise.all([
      tx.membership.findMany({ where, select: SELECT, orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { userId: 'asc' }], ...pageWindow(query) }),
      tx.membership.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, userId: string): Promise<MemberRow | null> {
    return tx.membership.findFirst({ where: { tenantId, userId }, select: SELECT });
  }

  /** The database function creates the global identity without a password, or returns the existing one untouched. */
  async inviteUser(tx: TenantTransaction, person: { email: string; firstName: string; lastName: string }): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT invite_user(${person.email}, ${person.firstName}, ${person.lastName})::text AS id`;
    return row!.id;
  }

  async create(tx: TenantTransaction, tenantId: string, member: NewMember): Promise<void> {
    await tx.membership.create({ data: { tenantId, status: 'INVITED', ...member } });
  }

  /** New links go in before the old ones go out: an active member must have a company at every statement of the commit check. */
  async replaceCompanies(tx: TenantTransaction, tenantId: string, userId: string, companyIds: readonly string[]): Promise<void> {
    await tx.membershipCompany.createMany({ data: companyIds.map((companyId) => ({ tenantId, userId, companyId })), skipDuplicates: true });
    await tx.membershipCompany.deleteMany({ where: { tenantId, userId, companyId: { notIn: [...companyIds] } } });
  }

  async update(tx: TenantTransaction, tenantId: string, userId: string, data: MemberWrite): Promise<void> {
    await tx.membership.updateMany({ where: { tenantId, userId }, data });
  }

  /** An admin role, or one holding `manage all`: whoever has it has full access. */
  async roleGrantsFullAccess(tx: TenantTransaction, tenantId: string, roleId: string): Promise<boolean> {
    const role = await tx.role.findFirst({
      where: { tenantId, id: roleId, OR: [{ isAdmin: true }, { permissions: { some: { permission: { action: 'manage', subject: 'all' } } } }] },
      select: { id: true },
    });
    return role !== null;
  }

  async findTenantName(tx: TenantTransaction, tenantId: string): Promise<string | undefined> {
    return (await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name;
  }
}
