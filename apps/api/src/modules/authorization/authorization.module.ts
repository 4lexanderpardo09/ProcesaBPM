import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { ABILITY_CACHE, InMemoryAbilityCache } from './application/ability-cache.js';
import { AbilityService, SUBJECT_REGISTRY } from './application/ability.service.js';
import { RolePermissionRepository } from './data/role-permission.repository.js';
import { SubjectRegistry } from './domain/subject-registry.js';
import { PermissionGuard } from './http/permission.guard.js';
import { RequestAuthGuard } from './http/request-auth.guard.js';
import { RouteAccessAuditor } from './http/route-access-auditor.js';

/**
 * Authorization with CASL. Registers THE global guard (token, then permission). Domain modules
 * register the subjects that accept conditions in the `SubjectRegistry`.
 */
@Module({
  imports: [AuthModule],
  providers: [
    { provide: SUBJECT_REGISTRY, useFactory: () => new SubjectRegistry() },
    { provide: ABILITY_CACHE, useClass: InMemoryAbilityCache },
    RolePermissionRepository,
    AbilityService,
    PermissionGuard,
    RequestAuthGuard,
    RouteAccessAuditor,
    { provide: APP_GUARD, useExisting: RequestAuthGuard },
  ],
  exports: [AbilityService, SUBJECT_REGISTRY],
})
export class AuthorizationModule {}
