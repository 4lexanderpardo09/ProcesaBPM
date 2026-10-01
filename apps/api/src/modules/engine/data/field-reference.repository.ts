import { Injectable } from '@nestjs/common';
import type { ReferenceToVerify } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

type Check = (tx: TenantTransaction, tenantId: string, value: string, config: Readonly<Record<string, unknown>>) => Promise<boolean>;

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const CHECKS: Readonly<Record<ReferenceToVerify['kind'], Check>> = {
  SITE: async (tx, tenantId, value, config) =>
    (await tx.site.count({ where: { tenantId, id: value, isActive: true, ...(typeof config.level === 'number' ? { level: config.level } : {}) } })) > 0,
  USER: async (tx, tenantId, value, config) =>
    (await tx.membership.count({
      where: { tenantId, userId: value, status: 'ACTIVE', user: { status: { not: 'DISABLED' } }, ...(isStringList(config.positionIds) && config.positionIds.length > 0 ? { positionId: { in: config.positionIds } } : {}) },
    })) > 0,
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

/** Checks that the ids and values a person typed exist in this tenant (the form cannot be trusted). */
@Injectable()
export class FieldReferenceRepository {
  /** The field codes whose reference does not exist. */
  async findInvalid(tx: TenantTransaction, tenantId: string, references: readonly ReferenceToVerify[]): Promise<string[]> {
    const invalid = new Set<string>();
    for (const reference of references) {
      if (!(await CHECKS[reference.kind](tx, tenantId, reference.value, reference.config))) invalid.add(reference.fieldCode);
    }
    return [...invalid];
  }
}
