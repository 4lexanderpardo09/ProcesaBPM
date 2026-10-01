import { Inject, Injectable } from '@nestjs/common';
import { ROLE_TEMPLATES, type RoleTemplate } from '@procesabpm/db';
import { MissingCatalogPermissionError } from '@procesabpm/shared';
import { PlatformPrismaService } from '../../../infrastructure/database/platform-prisma.service.js';
import { type CatalogEntry, type PlatformTransaction, TenantRoleRepository } from '../data/tenant-role.repository.js';

export const BASE_ROLE_TEMPLATES = Symbol('BASE_ROLE_TEMPLATES');

export interface CreatedRole {
  readonly id: string;
  readonly systemRole: RoleTemplate['systemRole'];
  readonly permissionCount: number;
}

/** Creates the base roles of a new tenant (`ROLE_TEMPLATES`) with the permissions of the catalog. */
@Injectable()
export class TenantRoleProvisioner {
  constructor(
    @Inject(PlatformPrismaService) private readonly platform: PlatformPrismaService,
    @Inject(TenantRoleRepository) private readonly repository: TenantRoleRepository,
    @Inject(BASE_ROLE_TEMPLATES) private readonly templates: readonly RoleTemplate[] = ROLE_TEMPLATES,
  ) {}

  /**
   * Inside the transaction of the caller (the tenant sign-up will pass its own, so the tenant and its
   * roles are created together), or in a new platform transaction when none is given. Not idempotent:
   * a second call for the same tenant fails on the unique role names.
   */
  createBaseRoles(tenantId: string, tx?: PlatformTransaction): Promise<CreatedRole[]> {
    return tx === undefined ? this.platform.$transaction((own) => this.create(own, tenantId)) : this.create(tx, tenantId);
  }

  private async create(tx: PlatformTransaction, tenantId: string): Promise<CreatedRole[]> {
    const catalog = await this.repository.findCatalog(tx);
    const grants = this.resolveGrants(catalog);
    const roles = await this.repository.createRoles(
      tx,
      tenantId,
      this.templates.map(({ systemRole, name, isAdmin }) => ({ systemRole, name, isAdmin })),
    );
    const roleIdOf = new Map(roles.map((role) => [role.systemRole, role.id]));
    await this.repository.createRolePermissions(
      tx,
      tenantId,
      grants.flatMap(({ systemRole, permissionIds }) => permissionIds.map((permissionId) => ({ roleId: roleIdOf.get(systemRole)!, permissionId }))),
    );
    return grants.map(({ systemRole, permissionIds }) => ({ id: roleIdOf.get(systemRole)!, systemRole, permissionCount: permissionIds.length }));
  }

  /** Every permission a template names must exist in the catalog: a missing one is an error, never skipped. */
  private resolveGrants(catalog: readonly CatalogEntry[]): Array<{ systemRole: RoleTemplate['systemRole']; permissionIds: string[] }> {
    const idOf = new Map(catalog.map((entry) => [`${entry.action}:${entry.subject}`, entry.id]));
    const missing = new Set<string>();
    const grants = this.templates.map((template) => ({
      systemRole: template.systemRole,
      permissionIds: template.permissions.flatMap(({ action, subject }) => {
        const id = idOf.get(`${action}:${subject}`);
        if (id === undefined) missing.add(`${action} ${subject}`);
        return id === undefined ? [] : [id];
      }),
    }));
    if (missing.size > 0) throw new MissingCatalogPermissionError([...missing].sort());
    return grants;
  }
}
