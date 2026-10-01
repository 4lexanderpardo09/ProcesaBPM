import { Module } from '@nestjs/common';
import { ROLE_TEMPLATES } from '@procesabpm/db';
import { PlatformDatabaseModule } from '../../infrastructure/database/platform-database.module.js';
import { PlatformOutboxRepository } from '../../infrastructure/outbox/platform-outbox.repository.js';
import { TenantDefaultsProvisioner } from './application/tenant-defaults-provisioner.js';
import { TenantOwnerInviter } from './application/tenant-owner-inviter.js';
import { BASE_ROLE_TEMPLATES, TenantRoleProvisioner } from './application/tenant-role-provisioner.js';
import { TenantSignupService } from './application/tenant-signup.service.js';
import { TenantStatusService } from './application/tenant-status.service.js';
import { PlatformAuditRepository } from './data/platform-audit.repository.js';
import { TenantDefaultsRepository } from './data/tenant-defaults.repository.js';
import { TenantOwnerRepository } from './data/tenant-owner.repository.js';
import { TenantRepository } from './data/tenant.repository.js';
import { TenantRoleRepository } from './data/tenant-role.repository.js';
import { PlatformTenantsController } from './http/platform-tenants.controller.js';

/** Platform administration: it acts on tenants with the login that bypasses row-level security. */
@Module({
  imports: [PlatformDatabaseModule],
  controllers: [PlatformTenantsController],
  providers: [
    PlatformOutboxRepository,
    PlatformAuditRepository,
    TenantRepository,
    TenantDefaultsRepository,
    TenantOwnerRepository,
    TenantRoleRepository,
    { provide: BASE_ROLE_TEMPLATES, useValue: ROLE_TEMPLATES },
    TenantRoleProvisioner,
    TenantDefaultsProvisioner,
    TenantOwnerInviter,
    TenantSignupService,
    TenantStatusService,
  ],
})
export class PlatformModule {}
