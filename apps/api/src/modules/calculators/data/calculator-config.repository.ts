import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** The configuration a tenant gave each built-in calculator; a row means the calculator is switched on. */
@Injectable()
export class CalculatorConfigRepository {
  async all(tx: TenantTransaction, tenantId: string): Promise<Map<string, Record<string, unknown>>> {
    const rows = await tx.calculatorConfig.findMany({ where: { tenantId }, select: { code: true, config: true } });
    return new Map(rows.map((row) => [row.code, row.config as Record<string, unknown>]));
  }

  async save(tx: TenantTransaction, tenantId: string, code: string, config: Record<string, unknown>): Promise<void> {
    const data = config as Prisma.InputJsonValue;
    await tx.calculatorConfig.upsert({ where: { tenantId_code: { tenantId, code } }, create: { tenantId, code, config: data }, update: { config: data } });
  }

  async remove(tx: TenantTransaction, tenantId: string, code: string): Promise<void> {
    await tx.calculatorConfig.deleteMany({ where: { tenantId, code } });
  }
}
