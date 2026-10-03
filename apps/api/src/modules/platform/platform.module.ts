import { Module } from '@nestjs/common';
import { ROLE_TEMPLATES } from '@procesabpm/db';
import { PlatformDatabaseModule } from '../../infrastructure/database/platform-database.module.js';
import { PlatformOutboxRepository } from '../../infrastructure/outbox/platform-outbox.repository.js';
import { TenantDefaultsProvisioner } from './application/tenant-defaults-provisioner.js';
import { TenantOwnerInviter } from './application/tenant-owner-inviter.js';
import { BASE_ROLE_TEMPLATES, TenantRoleProvisioner } from './application/tenant-role-provisioner.js';
import { AnnouncementAdminService } from './application/announcement-admin.service.js';
import { CountryCatalogService } from './application/country-catalog.service.js';
import { OperationsService } from './application/operations.service.js';
import { PlatformAuditQueryRepository } from './data/platform-audit-query.repository.js';
import { PlatformAuditQueryService } from './application/platform-audit-query.service.js';
import { PlanAdminService } from './application/plan-admin.service.js';
import { TenantAdminService } from './application/tenant-admin.service.js';
import { PlatformAdminsService } from './application/platform-admins.service.js';
import { TenantSignupService } from './application/tenant-signup.service.js';
import { TenantStatusService } from './application/tenant-status.service.js';
import { AnnouncementAdminRepository } from './data/announcement-admin.repository.js';
import { CountryCatalogRepository } from './data/country-catalog.repository.js';
import { OperationsRepository } from './data/operations.repository.js';
import { PlanAdminRepository } from './data/plan-admin.repository.js';
import { TenantAdminRepository } from './data/tenant-admin.repository.js';
import { PlatformAdminRepository } from './data/platform-admin.repository.js';
import { PlatformAuditRepository } from './data/platform-audit.repository.js';
import { TenantDefaultsRepository } from './data/tenant-defaults.repository.js';
import { TenantOwnerRepository } from './data/tenant-owner.repository.js';
import { TenantRepository } from './data/tenant.repository.js';
import { TenantRoleRepository } from './data/tenant-role.repository.js';
import { PlatformAdminsController } from './http/platform-admins.controller.js';
import { PlatformAnnouncementsController } from './http/platform-announcements.controller.js';
import { PlatformCatalogController } from './http/platform-catalog.controller.js';
import { PlatformOperationsController } from './http/platform-operations.controller.js';
import { PlatformAuditController } from './http/platform-audit.controller.js';
import { PlatformPlansController } from './http/platform-plans.controller.js';
import { PlatformTenantsController } from './http/platform-tenants.controller.js';

/** Platform administration: it acts on tenants with the login that bypasses row-level security. */
@Module({
  imports: [PlatformDatabaseModule],
  controllers: [PlatformTenantsController, PlatformAdminsController, PlatformPlansController, PlatformAnnouncementsController, PlatformCatalogController, PlatformOperationsController, PlatformAuditController],
  providers: [
    PlatformOutboxRepository,
    PlatformAuditRepository,
    PlatformAdminRepository,
    PlatformAdminsService,
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
    TenantAdminRepository,
    TenantAdminService,
    PlanAdminRepository,
    PlanAdminService,
    AnnouncementAdminRepository,
    AnnouncementAdminService,
    CountryCatalogRepository,
    CountryCatalogService,
    OperationsRepository,
    OperationsService,
    PlatformAuditQueryRepository,
    PlatformAuditQueryService,
  ],
})
export class PlatformModule {}
