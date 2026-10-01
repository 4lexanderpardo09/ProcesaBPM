import { Module } from '@nestjs/common';
import { ROLE_TEMPLATES } from '@procesabpm/db';
import { BASE_ROLE_TEMPLATES, TenantRoleProvisioner } from './application/tenant-role-provisioner.js';
import { TenantRoleRepository } from './data/tenant-role.repository.js';

/** Platform services (they use the login that bypasses row-level security). Tenant sign-up will live here. */
@Module({
  providers: [TenantRoleRepository, { provide: BASE_ROLE_TEMPLATES, useValue: ROLE_TEMPLATES }, TenantRoleProvisioner],
  exports: [TenantRoleProvisioner],
})
export class PlatformModule {}
