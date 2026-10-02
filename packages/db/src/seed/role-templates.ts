import type { PermissionSeed } from './catalog.js';

export type SystemRoleCode = 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'REQUESTER';

export interface RoleTemplate {
  systemRole: SystemRoleCode;
  name: string;
  isAdmin: boolean;
  permissions: ReadonlyArray<TemplatePermission>;
}

/** A grant of the catalog, optionally limited by a stored condition (placeholders such as `${membership.departmentId}` are resolved per member). */
export interface TemplatePermission extends Pick<PermissionSeed, 'action' | 'subject'> {
  conditions?: Readonly<Record<string, unknown>>;
}

const ticket = (...actions: string[]) => actions.map((action) => ({ action, subject: 'Ticket' }));
const read = (...subjects: string[]) => subjects.map((subject) => ({ action: 'read', subject }));

const CATALOG_SUBJECTS = ['Category', 'Subcategory', 'Priority', 'Company', 'Site', 'Department', 'Position'];

/**
 * Base roles created for every new tenant by the provisioning service.
 * Tenants can edit them or create their own roles from the permission catalog.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    systemRole: 'ADMIN',
    name: 'Administrador',
    isAdmin: true,
    permissions: [{ action: 'manage', subject: 'all' }],
  },
  {
    systemRole: 'SUPERVISOR',
    name: 'Supervisor',
    isAdmin: false,
    permissions: [
      ...ticket('create', 'create_for_others', 'read_all', 'comment', 'transition', 'reassign', 'open_incident', 'close', 'reopen', 'report_error'),
      ...read(...CATALOG_SUBJECTS, 'Workflow', 'Report', 'Export', 'Membership'),
      { action: 'export', subject: 'Report' },
      { action: 'manage', subject: 'Delegation' },
    ],
  },
  {
    systemRole: 'AGENT',
    name: 'Agente',
    isAdmin: false,
    permissions: [
      ...ticket('create', 'read_created', 'read_assigned', 'read_observed', 'comment', 'transition', 'open_incident', 'close', 'report_error'),
      ...read(...CATALOG_SUBJECTS),
      // Reports show people's results: an agent sees those of their own department, and nothing without one.
      { action: 'read', subject: 'Report', conditions: { departmentId: '${membership.departmentId}' } },
    ],
  },
  {
    systemRole: 'REQUESTER',
    name: 'Solicitante',
    isAdmin: false,
    permissions: [...ticket('create', 'read_created', 'comment'), ...read(...CATALOG_SUBJECTS)],
  },
];
