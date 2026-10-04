import { SetMetadata } from '@nestjs/common';

export const AVAILABLE_DURING_DELETION_KEY = 'auth:availableDuringDeletion';

/**
 * The route stays open to a member who signed in to an organization pending deletion (`tenantMode: 'DELETION_PENDING'`):
 * their own profile and the data export. Every other route refuses such a principal with 403 TENANT_PENDING_DELETION
 * (`RequestAuthGuard`). It widens nothing for anyone else and is meaningless on public or platform routes. Adding it to a
 * route is a deliberate decision, fixed by the route protection test.
 */
export const AvailableDuringDeletion = (): MethodDecorator => SetMetadata(AVAILABLE_DURING_DELETION_KEY, true);

/** Read from the handler only: a whole controller cannot be opened by accident. */
export function isAvailableDuringDeletion(handler: object): boolean {
  return Reflect.getMetadata(AVAILABLE_DURING_DELETION_KEY, handler) === true;
}
