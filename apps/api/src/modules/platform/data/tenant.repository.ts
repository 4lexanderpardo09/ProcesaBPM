import { Injectable } from '@nestjs/common';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface CountryReference {
  readonly code: string;
  readonly currencyCode: string;
  readonly timeZone: string;
}

export type ManagedTenantStatus = 'ACTIVE' | 'SUSPENDED';

export interface NewTenant {
  readonly slug: string;
  readonly name: string;
  readonly planId: string;
  readonly country: CountryReference;
}

@Injectable()
export class TenantRepository {
  async findActivePlanId(tx: PlatformTransaction, code: string): Promise<string | undefined> {
    const plan = await tx.plan.findFirst({ where: { code, isActive: true }, select: { id: true } });
    return plan?.id;
  }

  async findCountry(tx: PlatformTransaction, code: string): Promise<CountryReference | undefined> {
    const country = await tx.country.findUnique({ where: { code }, select: { code: true, currencyCode: true, timeZone: true } });
    return country ?? undefined;
  }

  /** `undefined` when the slug is taken: the unique index decides, so concurrent sign-ups cannot both win. */
  async insert(tx: PlatformTransaction, tenant: NewTenant): Promise<string | undefined> {
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO tenants (slug, name, plan_id, country_code, time_zone)
      VALUES (${tenant.slug}, ${tenant.name}, ${tenant.planId}::uuid, ${tenant.country.code}, ${tenant.country.timeZone})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id::text AS id`;
    return row?.id;
  }

  async createUsage(tx: PlatformTransaction, tenantId: string): Promise<void> {
    await tx.tenantUsage.create({ data: { tenantId } });
  }

  /** Locks the row, so two status changes of the same tenant cannot interleave. */
  async lockStatus(tx: PlatformTransaction, tenantId: string): Promise<string | undefined> {
    const [row] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    return row?.status;
  }

  async updateStatus(tx: PlatformTransaction, tenantId: string, status: ManagedTenantStatus): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { status } });
  }
}
