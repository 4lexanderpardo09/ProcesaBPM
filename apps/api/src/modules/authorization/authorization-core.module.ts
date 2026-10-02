import { Module } from '@nestjs/common';
import { SUBJECT_REGISTRY } from './application/ability.service.js';
import { RolePermissionRepository } from './data/role-permission.repository.js';
import { SubjectRegistry } from './domain/subject-registry.js';

/**
 * What both the API and the worker need to evaluate permissions: the registry of subjects (domain modules register
 * theirs in it) and the reading of a role's rules. The guards and the per-request ability live in `AuthorizationModule`.
 */
@Module({
  providers: [{ provide: SUBJECT_REGISTRY, useFactory: () => new SubjectRegistry() }, RolePermissionRepository],
  exports: [SUBJECT_REGISTRY, RolePermissionRepository],
})
export class AuthorizationCoreModule {}
