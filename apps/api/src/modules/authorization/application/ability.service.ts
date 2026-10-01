import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../../../common/auth/principal.js';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RolePermissionRepository } from '../data/role-permission.repository.js';
import { type AppAbility, buildAbility, type RawPermissionRule } from '../domain/build-ability.js';
import { SubjectRegistry } from '../domain/subject-registry.js';
import { ABILITY_CACHE, type AbilityCache } from './ability-cache.js';

export const SUBJECT_REGISTRY = Symbol('SUBJECT_REGISTRY');

const FULL_ACCESS: readonly RawPermissionRule[] = [{ action: 'manage', subject: 'all', conditions: null }];

@Injectable()
export class AbilityService {
  constructor(
    @Inject(ABILITY_CACHE) private readonly cache: AbilityCache,
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(RolePermissionRepository) private readonly repository: RolePermissionRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * What the member may do:
   * - the owner of the tenant, and members of an active admin role, can do everything (`manage all`);
   * - a role that is not active grants nothing;
   * - otherwise, the rules of the role, resolved for this member. They are cached per tenant, role and
   *   permissions version, so a change of permissions takes effect on every instance at once.
   * The ability is built for each request.
   */
  async forPrincipal(principal: Principal): Promise<AppAbility> {
    const rules = await this.rulesOf(principal);
    const { ability, dropped } = buildAbility(rules, { userId: principal.userId, membership: principal.membership }, this.registry);
    for (const rule of dropped) {
      this.logger.warn('Permission rule not applied', { event: 'authorization.rule_dropped', roleId: principal.roleId, ...rule });
    }
    return ability;
  }

  private async rulesOf(principal: Principal): Promise<readonly RawPermissionRule[]> {
    if (principal.isOwner || (principal.roleActive && principal.roleIsAdmin)) return FULL_ACCESS;
    if (!principal.roleActive) return [];

    const { tenantId, roleId, userId, permissionsVersion } = principal;
    const cached = await this.cache.get(tenantId, roleId, permissionsVersion);
    if (cached !== undefined) return cached;

    const loaded = await this.tenantContext.run({ tenantId, userId }, () =>
      this.runner.withTenantTransaction((tx) => this.repository.loadRules(tx, tenantId, roleId)),
    );
    if (loaded === undefined) return [];
    // Stored under the version read together with the rules, which may be newer than the principal's.
    await this.cache.set(tenantId, roleId, loaded.version, loaded.rules);
    return loaded.rules;
  }
}
