import { PERMISSIONS } from '@procesabpm/db';
import { isCatalogScopedAction } from './subject-registry.js';
import type { RawPermissionRule } from './build-ability.js';

/** Things support never reads even though a member's role could: secrets and the tenant's own audit of itself. */
const HIDDEN_FROM_SUPPORT: ReadonlySet<string> = new Set(['Webhook', 'AuditLog', 'Setting', 'SupportAccess']);

/**
 * What a platform administrator can do under a support grant (v1): read, and nothing else. Built from the catalog, never
 * from a tenant role: every `read` and `read_all`, except the scoped ones (`read_created`… mean "mine", and support has no
 * "mine") and the subjects above. Writes do not exist in this list, and the guard also refuses any method but GET.
 */
export const SUPPORT_READ_ONLY_RULES: readonly RawPermissionRule[] = PERMISSIONS.filter(
  (permission) =>
    (permission.action === 'read' || permission.action === 'read_all') &&
    !isCatalogScopedAction(permission.subject, permission.action) &&
    !HIDDEN_FROM_SUPPORT.has(permission.subject),
).map((permission) => ({ action: permission.action, subject: permission.subject, conditions: null }));
