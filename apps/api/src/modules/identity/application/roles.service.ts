import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateRoleRequest,
  InvalidStateError,
  NotFoundError,
  type Page,
  type PageQuery,
  type ReplaceRolePermissionsRequest,
  type RolePermissionResponse,
  type RoleResponse,
  type UpdateRoleRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SUBJECT_REGISTRY } from '../../authorization/application/ability.service.js';
import type { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { RoleRepository, type RoleRow, type RoleWrite } from '../data/role.repository.js';
import { permissionKey, validateRolePermissions } from '../domain/role-permission-validation.js';

const summaryOf = (row: RoleRow) => ({ name: row.name, isActive: row.isActive, isAdmin: row.isAdmin });

/** `action subject` per permission, flagged when it carries conditions: enough to see who gained or lost what. */
const permissionSummary = (rows: ReadonlyArray<{ action: string; subject: string; conditions: unknown }>) =>
  rows.map((row) => `${row.action} ${row.subject}${row.conditions === null ? '' : ' (conditional)'}`).sort();

const toResponse = (row: RoleRow): RoleResponse => ({ ...row, createdAt: row.createdAt.toISOString() });

/**
 * Creating or marking an admin role is guarded by the database (only an administrator may). So is granting a
 * permission: a role can only be given permissions the actor already holds (an administrator, who holds
 * `manage all`, can give anything). Both violations arrive as a typed 403.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(RoleRepository) private readonly repository: RoleRepository,
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(query: PageQuery): Promise<Page<RoleResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<RoleResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  create(request: CreateRoleRequest): Promise<RoleResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const created = await this.repository.create(tx, this.tenantId, { name: request.name, ...compact({ description: request.description, isAdmin: request.isAdmin }) });
      await this.audit.record(tx, { action: 'role.created', subjectType: 'Role', subjectId: created.id, after: summaryOf(created) });
      return toResponse(created);
    });
  }

  update(id: string, request: UpdateRoleRequest): Promise<RoleResponse> {
    return this.change(id, 'role.updated', compact(request));
  }

  activate(id: string): Promise<RoleResponse> {
    return this.change(id, 'role.activated', { isActive: true });
  }

  deactivate(id: string): Promise<RoleResponse> {
    return this.change(id, 'role.deactivated', { isActive: false });
  }

  /** Base roles (with a `system_role`) and roles that still have members are not deleted. */
  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const role = await this.require(tx, id);
      if (role.systemRole !== null) throw new InvalidStateError('A base role cannot be deleted');
      if ((await this.repository.countMembers(tx, this.tenantId, id)) > 0) throw new InvalidStateError('The role still has members');
      await this.repository.remove(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'role.deleted', subjectType: 'Role', subjectId: id, before: summaryOf(role) });
    });
  }

  permissions(id: string): Promise<RolePermissionResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      const rows = await this.repository.findPermissions(tx, this.tenantId, id);
      return rows.map((row) => ({ action: row.action, subject: row.subject, conditions: (row.conditions as Record<string, unknown> | null) ?? null }));
    });
  }

  /** Replaces the permission list of the role in one operation, after validating all of it. */
  replacePermissions(id: string, request: ReplaceRolePermissionsRequest): Promise<RolePermissionResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      const previous = await this.repository.findPermissions(tx, this.tenantId, id);
      const catalog = await this.repository.findCatalog(tx);
      validateRolePermissions(request.permissions, new Set(catalog.map((entry) => permissionKey(entry.action, entry.subject))), this.registry);
      const idOf = new Map(catalog.map((entry) => [permissionKey(entry.action, entry.subject), entry.id]));
      await this.repository.replacePermissions(
        tx,
        this.tenantId,
        id,
        request.permissions.map((permission) => ({ permissionId: idOf.get(permissionKey(permission.action, permission.subject))!, conditions: permission.conditions ?? null })),
      );
      const rows = await this.repository.findPermissions(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'role.permissions_replaced', subjectType: 'Role', subjectId: id, before: permissionSummary(previous), after: permissionSummary(rows) });
      return rows.map((row) => ({ action: row.action, subject: row.subject, conditions: (row.conditions as Record<string, unknown> | null) ?? null }));
    });
  }

  private change(id: string, action: 'role.updated' | 'role.activated' | 'role.deactivated', data: RoleWrite): Promise<RoleResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, data);
      const updated = await this.require(tx, id);
      await this.audit.record(tx, { action, subjectType: 'Role', subjectId: id, before: summaryOf(before), after: summaryOf(updated) });
      return toResponse(updated);
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<RoleRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
