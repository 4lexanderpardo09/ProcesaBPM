import type { DelegationResponse } from '@procesabpm/shared';

export type DelegationState = 'scheduled' | 'active' | 'ended';

/** Whether a delegation is still to come, in force or over, at a given moment. */
export function delegationState(delegation: Pick<DelegationResponse, 'startsAt' | 'endsAt'>, now: Date): DelegationState {
  if (new Date(delegation.endsAt) <= now) return 'ended';
  return new Date(delegation.startsAt) > now ? 'scheduled' : 'active';
}
