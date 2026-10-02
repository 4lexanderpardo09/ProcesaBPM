import type { RawPermissionRule } from './build-ability.js';

export const FULL_ACCESS: readonly RawPermissionRule[] = [{ action: 'manage', subject: 'all', conditions: null }];

/**
 * The rules that do not depend on what the role stores: the owner and members of an active admin role can do
 * everything, and a role that is not active grants nothing. `undefined` means "read the role's own rules".
 */
export function fixedRules(member: { readonly isOwner: boolean; readonly roleActive: boolean; readonly roleIsAdmin: boolean }): readonly RawPermissionRule[] | undefined {
  if (member.isOwner || (member.roleActive && member.roleIsAdmin)) return FULL_ACCESS;
  if (!member.roleActive) return [];
  return undefined;
}
