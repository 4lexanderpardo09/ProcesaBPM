import { Injectable } from '@nestjs/common';
import type { DataReference, FieldOptionResponse } from '@procesabpm/shared';
import type { Prisma } from '@procesabpm/db';
import { escapeLike } from '../../../common/crud/like-pattern.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

type Config = Readonly<Record<string, unknown>>;
type Check = (tx: TenantTransaction, tenantId: string, value: string, config: Config) => Promise<boolean>;

/** A field whose values are ids of the tenant's own records: a person, a site, or an entry of a preset list. */
export type ReferenceSource = { readonly kind: 'USER' | 'SITE' | 'PRESET'; readonly config: Config };

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const insensitive = (text: string) => ({ contains: escapeLike(text), mode: 'insensitive' as const });
const words = (q: string): string[] => q.split(/\s+/).filter((word) => word !== '');

// Each `where` is shared by the check of a submitted value and the options a form offers, so a form never offers what
// the submission would then refuse.
const siteWhere = (tenantId: string, config: Config): Prisma.SiteWhereInput => ({ tenantId, isActive: true, ...(typeof config.level === 'number' ? { level: config.level } : {}) });
const userWhere = (tenantId: string, config: Config): Prisma.MembershipWhereInput => ({
  tenantId,
  status: 'ACTIVE',
  user: { status: { not: 'DISABLED' } },
  ...(isStringList(config.positionIds) && config.positionIds.length > 0 ? { positionId: { in: config.positionIds } } : {}),
});

const CHECKS: Readonly<Record<DataReference['kind'], Check>> = {
  SITE: async (tx, tenantId, value, config) => (await tx.site.count({ where: { ...siteWhere(tenantId, config), id: value } })) > 0,
  USER: async (tx, tenantId, value, config) => (await tx.membership.count({ where: { ...userWhere(tenantId, config), userId: value } })) > 0,
  PRESET: async (tx, tenantId, value, config) => {
    switch (config.preset) {
      case 'COMPANIES':
        return (await tx.company.count({ where: { tenantId, id: value, isActive: true } })) > 0;
      case 'DEPARTMENTS':
        return (await tx.department.count({ where: { tenantId, id: value } })) > 0;
      case 'POSITIONS':
        return (await tx.position.count({ where: { tenantId, id: value } })) > 0;
      case 'SITES':
        return (await tx.site.count({ where: { tenantId, id: value, isActive: true } })) > 0;
      case 'USERS':
        return (await tx.membership.count({ where: { tenantId, userId: value, status: 'ACTIVE' } })) > 0;
      default:
        return false;
    }
  },
  DATASET: async (tx, tenantId, value, config) =>
    typeof config.datasetId === 'string' &&
    typeof config.column === 'string' &&
    (await tx.datasetRow.count({ where: { tenantId, datasetId: config.datasetId, dataset: { isActive: true }, data: { path: [config.column], equals: value } } })) > 0,
};

const NAMED = { select: { id: true, name: true }, orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }] };

/** Checks that the ids and values a person typed exist in this tenant (the form cannot be trusted), and offers them. */
@Injectable()
export class FieldReferenceRepository {
  /** The field codes whose reference does not exist. */
  async findInvalid(tx: TenantTransaction, tenantId: string, references: readonly DataReference[]): Promise<string[]> {
    const invalid = new Set<string>();
    for (const reference of references) {
      if (!(await CHECKS[reference.kind](tx, tenantId, reference.value, reference.config))) invalid.add(reference.fieldCode);
    }
    return [...invalid];
  }

  /** How the field stores its values, when they are ids of records: `null` for any other field (or none with that id). */
  async sourceOfField(tx: TenantTransaction, tenantId: string, fieldId: string): Promise<ReferenceSource | null> {
    const field = await tx.field.findFirst({ where: { tenantId, id: fieldId }, select: { type: true, config: true, dataSource: true } });
    if (field === null) return null;
    const config = asConfig(field.config);
    if (field.type === 'USER') return { kind: 'USER', config: { positionIds: config.positionIds } };
    if (field.type === 'SITE') return { kind: 'SITE', config: { level: config.level } };
    const source = asConfig(field.dataSource);
    if ((field.type === 'SELECT' || field.type === 'MULTI_SELECT') && source.kind === 'PRESET') return { kind: 'PRESET', config: { preset: source.preset } };
    return null;
  }

  /**
   * The records the field accepts whose name contains every word of `q` (ignoring case), by name. Inactive departments
   * and positions, and disabled people, are still accepted (a value already saved stays valid) but no longer offered.
   */
  async options(tx: TenantTransaction, tenantId: string, source: ReferenceSource, q: string, limit: number): Promise<FieldOptionResponse[]> {
    const named = <TWhere extends object>(where: TWhere) => ({ ...NAMED, take: limit, where: { ...where, AND: words(q).map((word) => ({ name: insensitive(word) })) } });
    switch (source.kind) {
      case 'USER':
        return this.people(tx, userWhere(tenantId, source.config), q, limit);
      case 'SITE':
        return toOptions(await tx.site.findMany(named(siteWhere(tenantId, source.config))));
      case 'PRESET':
        switch (source.config.preset) {
          case 'COMPANIES':
            return toOptions(await tx.company.findMany(named({ tenantId, isActive: true })));
          case 'DEPARTMENTS':
            return toOptions(await tx.department.findMany(named({ tenantId, isActive: true })));
          case 'POSITIONS':
            return toOptions(await tx.position.findMany(named({ tenantId, isActive: true })));
          case 'SITES':
            return toOptions(await tx.site.findMany(named({ tenantId, isActive: true })));
          case 'USERS':
            return this.people(tx, userWhere(tenantId, {}), q, limit);
          default:
            return [];
        }
    }
  }

  /** Each word has to be in the first or the last name. */
  private async people(tx: TenantTransaction, where: Prisma.MembershipWhereInput, q: string, limit: number): Promise<FieldOptionResponse[]> {
    const memberships = await tx.membership.findMany({
      where: { AND: [where, ...words(q).map((word) => ({ user: { OR: [{ firstName: insensitive(word) }, { lastName: insensitive(word) }] } }))] },
      select: { userId: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { userId: 'asc' }],
      take: limit,
    });
    return memberships.map((membership) => ({ value: membership.userId, label: `${membership.user.firstName} ${membership.user.lastName}`.trim() }));
  }
}

const asConfig = (value: unknown): Config => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Config) : {});
const toOptions = (rows: readonly { id: string; name: string }[]): FieldOptionResponse[] => rows.map((row) => ({ value: row.id, label: row.name }));
