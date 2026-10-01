import { Inject, Injectable } from '@nestjs/common';
import type { CreateTenantRequest, CreateTenantResponse } from '@procesabpm/shared';
import { InvalidReferenceError, TenantSlugTakenError } from '@procesabpm/shared';
import { applyDatabaseScope } from '../../../infrastructure/database/database-scope.js';
import { type PlatformTransaction, PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { TenantRepository } from '../data/tenant.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';
import { TenantDefaultsProvisioner } from './tenant-defaults-provisioner.js';
import { TenantOwnerInviter } from './tenant-owner-inviter.js';
import { TenantRoleProvisioner } from './tenant-role-provisioner.js';

/**
 * Creates a tenant with everything it needs to be usable, in ONE platform transaction: either the
 * whole tenant exists or nothing does. The owner receives an invitation; nothing here sets a password.
 */
@Injectable()
export class TenantSignupService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TenantRoleProvisioner) private readonly roles: TenantRoleProvisioner,
    @Inject(TenantDefaultsProvisioner) private readonly defaults: TenantDefaultsProvisioner,
    @Inject(TenantOwnerInviter) private readonly ownerInviter: TenantOwnerInviter,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  signUp(actorUserId: string, request: CreateTenantRequest): Promise<CreateTenantResponse> {
    return this.runner.run((tx) => this.create(tx, actorUserId, request));
  }

  private async create(tx: PlatformTransaction, actorUserId: string, request: CreateTenantRequest): Promise<CreateTenantResponse> {
    const planId = await this.tenants.findActivePlanId(tx, request.planCode);
    const country = await this.tenants.findCountry(tx, request.countryCode);
    if (planId === undefined) throw new InvalidReferenceError(`Unknown or inactive plan ${request.planCode}`);
    if (country === undefined) throw new InvalidReferenceError(`Unknown country ${request.countryCode}`);
    await this.ownerInviter.assertEmailCanOwn(tx, request.owner.email);

    const tenantId = await this.tenants.insert(tx, { slug: request.slug, name: request.name, planId, country });
    if (tenantId === undefined) throw new TenantSlugTakenError(request.slug);
    // The identity functions require a tenant in the scope; there is no acting user yet.
    await applyDatabaseScope(tx, { tenantId, userId: '' });

    await this.tenants.createUsage(tx, tenantId);
    const { companyId } = await this.defaults.provision(tx, tenantId, country);
    const adminRoleId = (await this.roles.createBaseRoles(tenantId, tx)).find((role) => role.systemRole === 'ADMIN')!.id;
    const ownerUserId = await this.ownerInviter.invite(tx, request.owner, { tenantId, tenantName: request.name, adminRoleId, companyId });

    await this.audit.record(tx, {
      actorUserId,
      action: PLATFORM_AUDIT_ACTIONS.tenantCreated,
      targetTenantId: tenantId,
      data: { slug: request.slug, planCode: request.planCode, countryCode: request.countryCode, ownerUserId },
    });
    return { tenantId, slug: request.slug, ownerUserId };
  }
}
