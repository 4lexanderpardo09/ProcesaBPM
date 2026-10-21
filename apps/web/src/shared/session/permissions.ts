import type { MyPermissionsResponse } from '@procesabpm/shared';

export type Permission = MyPermissionsResponse['permissions'][number];

/** An action the API might allow, as `[action, subject]`. */
export type PermissionCheck = readonly [action: string, subject: string];

/**
 * Whether the role grants the action on the subject at all, as CASL reads it: `manage` is any action and `all` any
 * subject. A conditional grant counts (it reaches some records); the API decides on each one.
 */
export function grants(permissions: readonly Permission[], [action, subject]: PermissionCheck): boolean {
  return permissions.some((permission) => (permission.action === action || permission.action === 'manage') && (permission.subject === subject || permission.subject === 'all'));
}
