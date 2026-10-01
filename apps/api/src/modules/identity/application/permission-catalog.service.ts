import { Inject, Injectable } from '@nestjs/common';
import type { PermissionCatalogGroup } from '@procesabpm/shared';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SUBJECT_REGISTRY } from '../../authorization/application/ability.service.js';
import type { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import { RoleRepository } from '../data/role.repository.js';
import { groupCatalogBySubject } from '../domain/permission-catalog.js';

@Injectable()
export class PermissionCatalogService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(RoleRepository) private readonly roles: RoleRepository,
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
  ) {}

  grouped(): Promise<PermissionCatalogGroup[]> {
    return this.runner.withTenantTransaction(async (tx) => groupCatalogBySubject(await this.roles.findCatalog(tx), this.registry));
  }
}
