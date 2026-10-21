import type { RolePermissionResponse } from '@procesabpm/shared';

/** `manage all` is what an administrator role means: the editor neither shows it nor drops it. */
export const FULL_ACCESS = { action: 'manage', subject: 'all' } as const;

const keyOf = (permission: { readonly action: string; readonly subject: string }) => `${permission.action} ${permission.subject}`;

/** The permissions of a role being edited, by `action subject`, each with the conditions it had (null: on every record). */
export type PermissionDraft = ReadonlyMap<string, RolePermissionResponse>;

export function draftOf(permissions: readonly RolePermissionResponse[]): PermissionDraft {
  return new Map(permissions.map((permission) => [keyOf(permission), permission]));
}

export function hasPermission(draft: PermissionDraft, action: string, subject: string): boolean {
  return draft.has(keyOf({ action, subject }));
}

export function isConditional(draft: PermissionDraft, action: string, subject: string): boolean {
  const conditions = draft.get(keyOf({ action, subject }))?.conditions;
  return conditions !== null && conditions !== undefined;
}

/**
 * Turns one permission on or off. Turning it off drops its conditions with it; turning it on gives it on every
 * record, since the conditions are not edited here (they come from the API as they were).
 */
export function togglePermission(draft: PermissionDraft, action: string, subject: string, on: boolean): PermissionDraft {
  const next = new Map(draft);
  const key = keyOf({ action, subject });
  if (on) {
    if (!next.has(key)) next.set(key, { action, subject, conditions: null });
  } else {
    next.delete(key);
  }
  return next;
}

/** The list the API replaces the role's with, conditions kept as they came. */
export function permissionsToSave(draft: PermissionDraft) {
  return [...draft.values()].map(({ action, subject, conditions }) => (conditions === null ? { action, subject } : { action, subject, conditions }));
}

/** Whether the draft differs from what the role has, to enable Save. */
export function draftChanged(draft: PermissionDraft, saved: readonly RolePermissionResponse[]): boolean {
  return saved.length !== draft.size || saved.some((permission) => !draft.has(keyOf(permission)));
}
