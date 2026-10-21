import { ApiError } from '@/shared/api';

/** What only happens on these screens, as a key of the `people` namespace; anything else, the shared admin message. */
export type PeopleErrorKey = 'errors.alreadyMember' | 'errors.notYourPermission' | 'errors.yourself' | 'errors.roleInUse' | 'errors.typeInUse' | 'errors.otherApprovalGroup' | 'errors.delegationOverlap';

export function peopleErrorKey(error: unknown, context: 'invite' | 'member' | 'rolePermissions' | 'role' | 'approvalType' | 'approvalMember' | 'delegation'): PeopleErrorKey | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (context === 'invite' && error.code === 'DUPLICATE') return 'errors.alreadyMember';
  // Giving a permission one does not hold, or lowering an administrator without being one, is refused with a 403.
  if (context === 'rolePermissions' && error.code === 'PERMISSION_DENIED') return 'errors.notYourPermission';
  if (context === 'member' && error.code === 'INVALID_STATE') return 'errors.yourself';
  if (context === 'role' && error.code === 'INVALID_STATE') return 'errors.roleInUse';
  if (context === 'approvalType' && error.code === 'INVALID_STATE') return 'errors.typeInUse';
  // A person belongs to one approval group per type and company.
  if (context === 'approvalMember' && error.code === 'DUPLICATE') return 'errors.otherApprovalGroup';
  // Two delegations of one person cannot overlap, nor can they go round in a circle.
  if (context === 'delegation' && error.code === 'OVERLAP') return 'errors.delegationOverlap';
  return undefined;
}
