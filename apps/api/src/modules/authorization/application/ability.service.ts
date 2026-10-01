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

@Injectable()
export class AbilityService {
  /**
   * Bumped by every invalidation. A load that was in flight while the role was invalidated must not
   * write its (possibly stale) rules to the cache afterwards.
   */
  private readonly generations = new Map<string, number>();

  constructor(
    @Inject(ABILITY_CACHE) private readonly cache: AbilityCache,
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(RolePermissionRepository) private readonly repository: RolePermissionRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * What the member may do: the rules of the role (cached per tenant and role) resolved for this
   * member. A role that is not active grants nothing. The ability is built for each request.
   * Whoever changes permissions must invalidate AFTER the change is committed.
   */
  async forPrincipal(principal: Principal): Promise<AppAbility> {
    const rules = principal.roleActive ? await this.rulesOf(principal.tenantId, principal.roleId, principal.userId) : [];
    const { ability, dropped } = buildAbility(rules, { userId: principal.userId, membership: principal.membership }, this.registry);
    for (const rule of dropped) {
      this.logger.warn('Permission rule not applied', { event: 'authorization.rule_dropped', roleId: principal.roleId, ...rule });
    }
    return ability;
  }

  /** The permissions of a role changed: the next request reads them again. */
  invalidateRole(tenantId: string, roleId: string): Promise<void> {
    this.bump(`${tenantId}:${roleId}`);
    return this.cache.invalidateRole(tenantId, roleId);
  }

  invalidateTenant(tenantId: string): Promise<void> {
    this.bump(tenantId);
    return this.cache.invalidateTenant(tenantId);
  }

  private async rulesOf(tenantId: string, roleId: string, userId: string): Promise<readonly RawPermissionRule[]> {
    const cached = await this.cache.get(tenantId, roleId);
    if (cached !== undefined) return cached;
    const generation = this.generationOf(tenantId, roleId);
    const rules = await this.tenantContext.run({ tenantId, userId }, () =>
      this.runner.withTenantTransaction((tx) => this.repository.loadRules(tx, roleId)),
    );
    if (this.generationOf(tenantId, roleId) === generation) await this.cache.set(tenantId, roleId, rules);
    return rules;
  }

  private bump(key: string): void {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  private generationOf(tenantId: string, roleId: string): string {
    return `${this.generations.get(tenantId) ?? 0}.${this.generations.get(`${tenantId}:${roleId}`) ?? 0}`;
  }
}
