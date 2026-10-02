import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationCoreModule } from './authorization-core.module.js';
import { ABILITY_CACHE, InMemoryAbilityCache } from './application/ability-cache.js';
import { AbilityService, SUBJECT_REGISTRY } from './application/ability.service.js';
import { PermissionGuard } from './http/permission.guard.js';
import { RequestAuthGuard } from './http/request-auth.guard.js';
import { RouteAccessAuditor } from './http/route-access-auditor.js';
import { ScopedActionsAuditor } from './http/scoped-actions-auditor.js';

/**
 * Authorization with CASL. Registers THE global guard (token, then permission). Domain modules
 * register the subjects that accept conditions in the `SubjectRegistry`.
 */
@Module({
  imports: [AuthModule, AuthorizationCoreModule],
  providers: [
    { provide: ABILITY_CACHE, useClass: InMemoryAbilityCache },
    AbilityService,
    PermissionGuard,
    RequestAuthGuard,
    RouteAccessAuditor,
    ScopedActionsAuditor,
    { provide: APP_GUARD, useExisting: RequestAuthGuard },
  ],
  exports: [AbilityService, AuthorizationCoreModule],
})
export class AuthorizationModule {}
