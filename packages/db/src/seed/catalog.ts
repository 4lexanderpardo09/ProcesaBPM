/**
 * Global catalog shipped with the platform. Loaded by `seedGlobalCatalog` and
 * safe to re-run: every row is upserted by its natural key.
 */

const GIGABYTE = 1024n ** 3n;

export interface CurrencySeed {
  code: string;
  name: string;
  decimals: number;
}

export interface CountrySeed {
  code: string;
  name: string;
  currencyCode: string;
  timeZone: string;
}

export interface PlanSeed {
  code: string;
  name: string;
  storageBaseBytes: bigint;
  storagePerUserBytes: bigint;
  maxUsers: number | null;
}

export interface PermissionSeed {
  action: string;
  subject: string;
  description: string;
}

export const CURRENCIES: readonly CurrencySeed[] = [
  { code: 'COP', name: 'Peso colombiano', decimals: 2 },
  { code: 'USD', name: 'Dólar estadounidense', decimals: 2 },
];

export const COUNTRIES: readonly CountrySeed[] = [
  { code: 'CO', name: 'Colombia', currencyCode: 'COP', timeZone: 'America/Bogota' },
];

/** Storage per plan approved on 2026-09-30 (docs/analisis.md §7.4.2): base + per active user. */
export const PLANS: readonly PlanSeed[] = [
  { code: 'trial', name: 'Prueba', storageBaseBytes: 1n * GIGABYTE, storagePerUserBytes: 0n, maxUsers: 5 },
  { code: 'basic', name: 'Básico', storageBaseBytes: 10n * GIGABYTE, storagePerUserBytes: 1n * GIGABYTE, maxUsers: null },
  { code: 'professional', name: 'Profesional', storageBaseBytes: 25n * GIGABYTE, storagePerUserBytes: 2n * GIGABYTE, maxUsers: null },
  { code: 'enterprise', name: 'Empresarial', storageBaseBytes: 100n * GIGABYTE, storagePerUserBytes: 5n * GIGABYTE, maxUsers: null },
];

const CRUD = ['create', 'read', 'update', 'delete'] as const;

/** Configuration subjects administered with plain CRUD. */
const ADMINISTERED_SUBJECTS = [
  'Company',
  'Department',
  'Position',
  'Site',
  'Calendar',
  'Membership',
  'Role',
  'Group',
  'ApprovalGroup',
  'Category',
  'Subcategory',
  'Priority',
  'ErrorType',
  'Dataset',
  'PdfDocument',
  'Webhook',
] as const;

/** Actions on tickets beyond CRUD, mapped to what the old system allowed per role. */
const TICKET_ACTIONS: readonly PermissionSeed[] = [
  { action: 'create', subject: 'Ticket', description: 'Create tickets for oneself' },
  { action: 'create_for_others', subject: 'Ticket', description: 'Create tickets on behalf of another member' },
  { action: 'read_created', subject: 'Ticket', description: 'See the tickets one created' },
  { action: 'read_assigned', subject: 'Ticket', description: 'See the tickets assigned to one (now or before)' },
  { action: 'read_observed', subject: 'Ticket', description: 'See the tickets of workflows one observes' },
  { action: 'read_all', subject: 'Ticket', description: 'See every ticket of the tenant' },
  { action: 'comment', subject: 'Ticket', description: 'Comment on accessible tickets' },
  { action: 'transition', subject: 'Ticket', description: 'Advance tickets assigned to one' },
  { action: 'reassign', subject: 'Ticket', description: 'Reassign tickets to another candidate' },
  { action: 'open_incident', subject: 'Ticket', description: 'Pause a ticket with an incident' },
  { action: 'close', subject: 'Ticket', description: 'Close tickets on a step that allows it' },
  { action: 'reopen', subject: 'Ticket', description: 'Reopen closed tickets' },
  { action: 'report_error', subject: 'Ticket', description: 'Report an error against a responsible' },
  { action: 'delete', subject: 'Ticket', description: 'Soft-delete tickets' },
];

export const PERMISSIONS: readonly PermissionSeed[] = [
  { action: 'manage', subject: 'all', description: 'Full access to the tenant' },
  ...ADMINISTERED_SUBJECTS.flatMap((subject) =>
    CRUD.map((action) => ({ action, subject, description: `${capitalize(action)} ${subject}` })),
  ),
  ...TICKET_ACTIONS,
  { action: 'read', subject: 'Workflow', description: 'See workflows and their versions' },
  { action: 'update', subject: 'Workflow', description: 'Edit workflow drafts' },
  { action: 'publish', subject: 'Workflow', description: 'Publish a workflow version' },
  { action: 'read', subject: 'Export', description: 'See scheduled exports and download files' },
  { action: 'update', subject: 'Export', description: 'Configure scheduled exports' },
  { action: 'generate', subject: 'Export', description: 'Run an export cutoff manually' },
  { action: 'read', subject: 'Report', description: 'See reports and dashboards' },
  { action: 'export', subject: 'Report', description: 'Download reports' },
  { action: 'read', subject: 'AuditLog', description: 'See the audit log' },
  { action: 'read', subject: 'Storage', description: 'See storage usage' },
  { action: 'update', subject: 'Setting', description: 'Change tenant settings and branding' },
  { action: 'manage', subject: 'Delegation', description: 'Manage delegations of any member' },
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
