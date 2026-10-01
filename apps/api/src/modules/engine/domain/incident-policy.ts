import { AssigneeRequiredError, type AssignmentMode } from '@procesabpm/shared';
import type { AssigneePlan } from './plan.js';

export interface RestoreInput {
  /** Who held the step when the incident was opened. */
  readonly previousAssigneeIds: readonly string[];
  /** Of those, the ones who are still active members. */
  readonly activeIds: ReadonlySet<string>;
  /** People with a pending parallel task in the current step and loop. */
  readonly pendingSignerIds: ReadonlySet<string>;
  /** The visit has an open clock nobody is responsible for: the step was a pool (or waiting for dispatch). */
  readonly poolClockOpen: boolean;
  readonly mode: AssignmentMode;
  /** The caller named who gets the ticket instead. */
  readonly explicitAssigneeId?: string | undefined;
}

export interface RestorePlan {
  readonly restore: readonly AssigneePlan[];
  readonly dropped: readonly string[];
}

/**
 * Who gets the ticket back when an incident is resolved: the original holders that are still active, each in
 * the role they had (signer, pool member or holder). Inactive ones are dropped. When there was someone and
 * nobody can come back, the caller must name who gets it, except on steps that assign by themselves later.
 */
export function restorePlan(input: RestoreInput): RestorePlan {
  const dropped = input.previousAssigneeIds.filter((id) => !input.activeIds.has(id));
  if (input.explicitAssigneeId !== undefined) return { restore: [], dropped };
  const restore = input.previousAssigneeIds
    .filter((id) => input.activeIds.has(id))
    .map((userId): AssigneePlan => ({ userId, type: input.pendingSignerIds.has(userId) ? 'PARALLEL' : input.poolClockOpen ? 'POOL' : 'PRIMARY' }));
  const selfAssigning = input.mode === 'PARALLEL' || input.mode === 'RANDOM_DISPATCH';
  if (input.previousAssigneeIds.length > 0 && restore.length === 0 && !selfAssigning) throw new AssigneeRequiredError(dropped);
  return { restore, dropped };
}

export interface ResolveAuthority {
  readonly actorId: string;
  readonly incident: { readonly createdById: string; readonly assignedToId: string };
  readonly canOpenIncident: boolean;
  readonly canReassign: boolean;
}

/** The person the incident was handed to resolves it; so does whoever opened it (if they may still open incidents) and a supervisor. */
export function mayResolveIncident({ actorId, incident, canOpenIncident, canReassign }: ResolveAuthority): boolean {
  return actorId === incident.assignedToId || (actorId === incident.createdById && canOpenIncident) || canReassign;
}
