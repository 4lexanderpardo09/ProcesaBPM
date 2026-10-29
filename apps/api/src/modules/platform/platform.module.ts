import { Module } from '@nestjs/common';
import { ROLE_TEMPLATES } from '@procesabpm/db';
import { JwtTokenService } from '../../infrastructure/security/jwt-token-service.js';
import { PlatformDatabaseModule } from '../../infrastructure/database/platform-database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { LoginBlocksModule } from '../announcements/login-blocks.module.js';
import { PlatformOutboxRepository } from '../../infrastructure/outbox/platform-outbox.repository.js';
import { TenantDefaultsProvisioner } from './application/tenant-defaults-provisioner.js';
import { TenantOwnerInviter } from './application/tenant-owner-inviter.js';
import { BASE_ROLE_TEMPLATES, TenantRoleProvisioner } from './application/tenant-role-provisioner.js';
import { AnnouncementAdminService } from './application/announcement-admin.service.js';
import { CountryCatalogService } from './application/country-catalog.service.js';
import { AiUsageService } from './application/ai-usage.service.js';
import { OperationsService } from './application/operations.service.js';
import { PlatformAuditQueryRepository } from './data/platform-audit-query.repository.js';
import { PlatformAuditQueryService } from './application/platform-audit-query.service.js';
import { SupportSessionService } from './application/support-session.service.js';
import { PlatformUserSupportService } from './application/platform-user-support.service.js';
import { TenantDeletionService } from './application/tenant-deletion.service.js';
import { PlanAdminService } from './application/plan-admin.service.js';
import { TenantAdminService } from './application/tenant-admin.service.js';
import { PlatformAdminsService } from './application/platform-admins.service.js';
import { TenantSignupService } from './application/tenant-signup.service.js';
import { TenantStatusService } from './application/tenant-status.service.js';
import { AnnouncementAdminRepository } from './data/announcement-admin.repository.js';
import { CountryCatalogRepository } from './data/country-catalog.repository.js';
import { AiUsageRepository } from './data/ai-usage.repository.js';
import { OperationsRepository } from './data/operations.repository.js';
import { SupportSessionRepository } from './data/support-session.repository.js';
import { PlatformUserRepository } from './data/platform-user.repository.js';
import { TenantDeletionRepository } from './data/tenant-deletion.repository.js';
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
import { PlatformDemoRequestsController } from './http/platform-demo-requests.controller.js';
import { PlatformEmailSuppressionsController } from './http/platform-email-suppressions.controller.js';
import { EmailSuppressionAdminRepository } from './data/email-suppression-admin.repository.js';
import { EmailSuppressionAdminService } from './application/email-suppression-admin.service.js';
import { DemoRequestAdminRepository } from './data/demo-request-admin.repository.js';
import { DemoRequestAdminService } from './application/demo-request-admin.service.js';
import { PlatformCatalogController } from './http/platform-catalog.controller.js';
import { PlatformAiUsageController } from './http/platform-ai-usage.controller.js';
import { PlatformOperationsController } from './http/platform-operations.controller.js';
import { PlatformAuditController } from './http/platform-audit.controller.js';
import { PlatformSupportController } from './http/platform-support.controller.js';
import { PlatformDeletionController } from './http/platform-deletion.controller.js';
import { PlatformPlansController } from './http/platform-plans.controller.js';
import { PlatformTenantsController } from './http/platform-tenants.controller.js';
import { PlatformUsersController } from './http/platform-users.controller.js';

/** Platform administration: it acts on tenants with the login that bypasses row-level security. */
@Module({
  // AuthModule only for the shared rate limiter (support's lookups and MFA resets are limited per administrator and user).
  imports: [PlatformDatabaseModule, AuthModule, LoginBlocksModule],
  controllers: [
    PlatformTenantsController,
    PlatformAdminsController,
    PlatformPlansController,
    PlatformAnnouncementsController,
    PlatformCatalogController,
    PlatformOperationsController,
    PlatformAiUsageController,
    PlatformAuditController,
    PlatformSupportController,
    PlatformDeletionController,
    PlatformUsersController,
    PlatformDemoRequestsController,
    PlatformEmailSuppressionsController,
  ],
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
    DemoRequestAdminRepository,
    DemoRequestAdminService,
    EmailSuppressionAdminRepository,
    EmailSuppressionAdminService,
    CountryCatalogRepository,
    CountryCatalogService,
    OperationsRepository,
    OperationsService,
    AiUsageRepository,
    AiUsageService,
    PlatformAuditQueryRepository,
    PlatformAuditQueryService,
    SupportSessionRepository,
    SupportSessionService,
    PlatformUserRepository,
    PlatformUserSupportService,
    TenantDeletionRepository,
    TenantDeletionService,
    JwtTokenService,
  ],
})
export class PlatformModule {}
