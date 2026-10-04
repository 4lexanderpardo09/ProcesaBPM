import type { RawPermissionRule } from './build-ability.js';

export const FULL_ACCESS: readonly RawPermissionRule[] = [{ action: 'manage', subject: 'all', conditions: null }];

export interface FullAccessFacts {
  readonly isOwner: boolean;
  readonly roleActive: boolean;
  readonly roleIsAdmin: boolean;
}

/** The owner and the members of an active admin role can do everything, whatever the role's stored rules say. */
export function hasFullAccess(member: FullAccessFacts): boolean {
  return member.isOwner || (member.roleActive && member.roleIsAdmin);
}

/**
 * The rules that do not depend on what the role stores: full access (see `hasFullAccess`), and a role that is not active
 * grants nothing. `undefined` means "read the role's own rules".
 */
export function fixedRules(member: FullAccessFacts): readonly RawPermissionRule[] | undefined {
  if (hasFullAccess(member)) return FULL_ACCESS;
  if (!member.roleActive) return [];
  return undefined;
}
