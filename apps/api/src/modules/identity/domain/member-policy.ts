import { InvalidStateError } from '@procesabpm/shared';
import type { MemberStatusValue } from '../data/member.repository.js';

export interface MemberState {
  readonly status: MemberStatusValue;
  readonly joinedAt: Date | null;
}

/** An invitation can be sent again only while the member has not accepted it. */
export function assertInvitationPending(member: MemberState): void {
  if (member.status !== 'INVITED' || member.joinedAt !== null) throw new InvalidStateError('The member has already accepted the invitation');
}

/**
 * Status after reactivating: an accepted member is ACTIVE again; one who never accepted goes back to
 * INVITED (the invitation can be sent again), never straight to ACTIVE without a password.
 */
export function statusAfterActivation(member: MemberState): MemberStatusValue {
  if (member.status !== 'INACTIVE') throw new InvalidStateError('Only a deactivated member can be activated');
  return member.joinedAt === null ? 'INVITED' : 'ACTIVE';
}

export function assertCanDeactivate(member: MemberState, actingUserId: string, memberUserId: string): void {
  if (member.status === 'INACTIVE') throw new InvalidStateError('The member is already deactivated');
  if (actingUserId === memberUserId) throw new InvalidStateError('You cannot deactivate yourself');
}
