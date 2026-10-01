import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'auth:requiredPermissions';
export const AUTHENTICATED_ONLY_KEY = 'auth:authenticatedOnly';

export interface PermissionRequirement {
  /** Any one of these actions on `subject` is enough. */
  readonly actions: readonly string[];
  readonly subject: string;
}

/**
 * The route needs `action` on `subject` (names from the permission catalog, e.g. `read`, `Company`).
 * This is a type-level check; use cases that touch a concrete record also check it (see `record-access`).
 */
export const RequirePermission = (action: string, subject: string): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PermissionRequirement>(REQUIRED_PERMISSIONS_KEY, { actions: [action], subject });

/** Same as `RequirePermission`, satisfied by any of the actions (e.g. the scoped ticket reads). */
export const RequireAnyPermission = (actions: readonly string[], subject: string): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PermissionRequirement>(REQUIRED_PERMISSIONS_KEY, { actions, subject });

/**
 * Explicit opt-out of the permission check for routes that only need a signed-in user (e.g. the
 * profile of the caller). Without it, an authenticated route that declares no permission is refused.
 */
export const AuthenticatedOnly = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
