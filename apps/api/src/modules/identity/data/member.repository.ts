import { Injectable } from '@nestjs/common';
import type { MembersQuery } from '@procesabpm/shared';
import { escapeLike } from '../../../common/crud/like-pattern.js';
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

export interface DirectoryRow {
  readonly userId: string;
  readonly user: { readonly firstName: string; readonly lastName: string };
}

const DIRECTORY_SELECT = { userId: true, user: { select: { firstName: true, lastName: true } } } as const;

/** Every query carries the tenant explicitly on top of row-level security. */
export interface SignatureFile {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
}

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

  /**
   * Active members whose first or last name holds every word of the search, by name. Pending invitations are left out:
   * until they accept, their names may be another organization's.
   */
  searchDirectory(tx: TenantTransaction, tenantId: string, search: string, limit: number): Promise<DirectoryRow[]> {
    const words = search.split(/\s+/).filter((word) => word !== '');
    return tx.membership.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        AND: words.map((word) => ({
          user: { OR: [{ firstName: { contains: escapeLike(word), mode: 'insensitive' as const } }, { lastName: { contains: escapeLike(word), mode: 'insensitive' as const } }] },
        })),
      },
      select: DIRECTORY_SELECT,
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { userId: 'asc' }],
      take: limit,
    });
  }

  /** The names behind some ids: members that are or were active (a pending invitation has no names to show yet). */
  namesOf(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<DirectoryRow[]> {
    return tx.membership.findMany({ where: { tenantId, userId: { in: [...userIds] }, status: { not: 'INVITED' } }, select: DIRECTORY_SELECT });
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

  /** The member's signature image, or null when they have none (or are not a member here). */
  async signatureFile(tx: TenantTransaction, tenantId: string, userId: string): Promise<SignatureFile | null> {
    const membership = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { signatureFile: { select: { id: true, storageKey: true, mimeType: true } } } });
    return membership?.signatureFile ?? null;
  }

  /** A confirmed image the given person uploaded here, to become somebody's signature. */
  uploadedImage(tx: TenantTransaction, tenantId: string, uploaderId: string, fileId: string): Promise<SignatureFile | null> {
    return tx.storedFile.findFirst({ where: { tenantId, id: fileId, uploadedById: uploaderId, origin: 'USER', status: 'CONFIRMED' }, select: { id: true, storageKey: true, mimeType: true } });
  }

  async linkSignature(tx: TenantTransaction, tenantId: string, userId: string, fileId: string | null): Promise<void> {
    await tx.membership.update({ where: { tenantId_userId: { tenantId, userId } }, data: { signatureFileId: fileId } });
  }
}
