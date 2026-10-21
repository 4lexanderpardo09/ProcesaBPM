import { ApiError } from '@/shared/api';

/** What only happens on these screens, as a key of the `people` namespace; anything else, the shared admin message. */
export type PeopleErrorKey = 'errors.alreadyMember' | 'errors.notYourPermission' | 'errors.yourself' | 'errors.roleInUse';

export function peopleErrorKey(error: unknown, context: 'invite' | 'member' | 'rolePermissions' | 'role'): PeopleErrorKey | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (context === 'invite' && error.code === 'DUPLICATE') return 'errors.alreadyMember';
  // Giving a permission one does not hold, or lowering an administrator without being one, is refused with a 403.
  if (context === 'rolePermissions' && error.code === 'PERMISSION_DENIED') return 'errors.notYourPermission';
  if (context === 'member' && error.code === 'INVALID_STATE') return 'errors.yourself';
  if (context === 'role' && error.code === 'INVALID_STATE') return 'errors.roleInUse';
  return undefined;
}
