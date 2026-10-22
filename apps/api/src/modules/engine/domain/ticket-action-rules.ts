import {
  type DomainError,
  IncidentNotOpenError,
  InvalidStateError,
  NotFoundError,
  ParallelTaskNotPendingError,
  PermissionDeniedError,
  StaleTicketError,
  TicketNotClosedError,
  TicketNotOpenError,
  TicketWaitingError,
  type WorkflowVersionDocument,
} from '@procesabpm/shared';
import { mayResolveIncident } from './incident-policy.js';
import type { ParallelStatus } from './parallel-policy.js';

/**
 * The rules that decide whether someone may act on a ticket in its current state. Each one answers with the error
 * the action would fail with, or `null` when it lets the action through: the engine services throw that error and
 * the ticket detail turns `null` into "you may", so the interface and the routes can never disagree.
 */

export type TicketStatus = 'OPEN' | 'PAUSED' | 'CLOSED';
export type AssigneeType = 'PRIMARY' | 'POOL' | 'PARALLEL' | 'INCIDENT';
/** The ticket permissions an action is checked against, always on the concrete ticket (stored conditions apply). */
export type TicketAction = 'transition' | 'reassign' | 'close' | 'open_incident' | 'reopen' | 'comment' | 'update';

export interface Assignment {
  readonly userId: string;
  readonly type: AssigneeType;
}

export interface Signature {
  readonly userId: string;
  readonly status: ParallelStatus;
}

/** "Holds the step" means PRIMARY or POOL: signers and incident assignees have their own paths. */
export const holdsStep = (ownType: AssigneeType | undefined): boolean => ownType === 'PRIMARY' || ownType === 'POOL';

/** For opening an incident a signer of a parallel step holds it too: the incident hands over their part. */
export const holdsStepOrSignature = (ownType: AssigneeType | undefined): boolean => holdsStep(ownType) || ownType === 'PARALLEL';

/**
 * Every action on the current step needs an open ticket with an open visit that is not parked on a WAIT block, and
 * the visit the caller saw (`seenVisitId`) must still be the open one: otherwise someone moved the ticket first.
 */
export function openVisitRefusal(status: TicketStatus, visit: { readonly id: string; readonly resumeAt: Date | null } | null, seenVisitId: string): DomainError | null {
  if (status !== 'OPEN') return new TicketNotOpenError(status);
  if (visit === null) return new InvalidStateError('The ticket has no open step');
  if (visit.id !== seenVisitId) return new StaleTicketError();
  if (visit.resumeAt !== null) return new TicketWaitingError(visit.resumeAt);
  return null;
}

export interface ActAuthority {
  /** The action itself (`transition` or `close`) on this ticket. */
  readonly may: boolean;
  /** `reassign` on this ticket: lets a supervisor move a step they do not hold. */
  readonly mayReassign: boolean;
  readonly ownType: AssigneeType | undefined;
}

/** `transition`: whoever holds the step, or a supervisor with `reassign`; `close`: whoever holds it. Both need the action on this ticket. */
export function actRefusal(action: 'transition' | 'close', { may, mayReassign, ownType }: ActAuthority): DomainError | null {
  const allowed = may && (holdsStep(ownType) || (action === 'transition' && mayReassign));
  return allowed ? null : new PermissionDeniedError('Not allowed to act on this ticket');
}

/**
 * Taking needs `transition` on this ticket and being one of its pool. A ticket waiting for dispatch is not a pool:
 * nobody takes it. When the pool is gone because someone took it first, the caller lost a race (409).
 */
export function takeRefusal(mayTransition: boolean, ownType: AssigneeType | undefined, assignees: readonly Assignment[]): DomainError | null {
  if (!mayTransition) return new PermissionDeniedError('Not allowed to take this ticket');
  if (ownType === 'POOL') return null;
  return assignees.some((assignee) => assignee.type === 'PRIMARY') ? new StaleTicketError() : new PermissionDeniedError('The ticket is not in a pool you belong to');
}

export const reassignRefusal = (mayReassign: boolean): DomainError | null => (mayReassign ? null : new PermissionDeniedError('Not allowed to reassign tickets'));

/** On a parallel step what is handed over is one pending signature, so there must be one left to move. */
export const hasPendingSignature = (signatures: readonly Signature[]): boolean => signatures.some((signature) => signature.status === 'PENDING');

/** Whoever holds the step (also a signer) or a supervisor with `reassign` opens an incident, with `open_incident` on this ticket. */
export function openIncidentRefusal(mayOpenIncident: boolean, mayReassign: boolean, ownType: AssigneeType | undefined): DomainError | null {
  return mayOpenIncident && (holdsStepOrSignature(ownType) || mayReassign) ? null : new PermissionDeniedError('Not allowed to open an incident on this ticket');
}

export interface IncidentState {
  readonly status: 'OPEN' | 'RESOLVED';
  readonly createdById: string;
  readonly assignedToId: string;
}

export interface ResolveState {
  readonly actorId: string;
  /** The incident named by the request (`null`: it is not one of this ticket's). */
  readonly incident: IncidentState | null;
  readonly ticketStatus: TicketStatus;
  readonly hasOpenVisit: boolean;
  readonly mayOpenIncident: boolean;
  readonly mayReassign: boolean;
}

/** An open incident of a paused ticket, resolved by the person it is for, whoever opened it (still with `open_incident`) or a supervisor. */
export function resolveIncidentRefusal({ actorId, incident, ticketStatus, hasOpenVisit, mayOpenIncident, mayReassign }: ResolveState): DomainError | null {
  if (incident === null) return new NotFoundError();
  if (incident.status !== 'OPEN') return new IncidentNotOpenError();
  if (ticketStatus !== 'PAUSED' || !hasOpenVisit) return new InvalidStateError('The ticket is not paused by this incident');
  return mayResolveIncident({ actorId, incident, canOpenIncident: mayOpenIncident, canReassign: mayReassign }) ? null : new PermissionDeniedError('Not allowed to resolve this incident');
}

/** Only a closed ticket is reopened, by someone with `reopen` on it (the step it goes back to is `reopenTarget`'s rule). */
export function reopenRefusal(mayReopen: boolean, status: TicketStatus): DomainError | null {
  if (!mayReopen) return new PermissionDeniedError('Not allowed to reopen this ticket');
  return status === 'CLOSED' ? null : new TicketNotClosedError(status);
}

/** Editing the subject, description or priority: the permission on this very ticket, and the ticket not closed. */
export function editRefusal(mayEdit: boolean, status: TicketStatus): DomainError | null {
  if (!mayEdit) return new PermissionDeniedError('Not allowed to edit this ticket');
  return status === 'CLOSED' ? new InvalidStateError('A closed ticket cannot be edited') : null;
}

/** Signing or rejecting: the current step is a parallel one and the caller's own signature on it is still pending. */
export function signatureRefusal(parallelStep: boolean, signatures: readonly Signature[], actorId: string): DomainError | null {
  if (!parallelStep) return new InvalidStateError('The current step is not a parallel step');
  const mine = signatures.find((signature) => signature.userId === actorId);
  if (mine === undefined) return new PermissionDeniedError('You are not a signer of this step');
  return mine.status === 'PENDING' ? null : new ParallelTaskNotPendingError();
}

/** Commenting is allowed in any status, with `comment` on this ticket. */
export const commentRefusal = (mayComment: boolean): DomainError | null => (mayComment ? null : new PermissionDeniedError('Not allowed to comment on this ticket'));

/** The DECISION ways out of a step, in the builder's order: what a person chooses from when advancing. */
export const decisionExits = (document: WorkflowVersionDocument, stepId: string) =>
  document.transitions.filter((transition) => transition.fromStepId === stepId && transition.type === 'DECISION').sort((a, b) => a.sortOrder - b.sortOrder);

/** Who may receive a step or an incident: an active member (`null` when the person is not one) of the ticket's company. */
export const isEligibleAssignee = (member: { readonly companyIds: readonly string[] } | null, companyId: string): boolean => member !== null && member.companyIds.includes(companyId);

/** Handing the step to the person who already holds it alone would change nothing. */
export const isSoleHolder = (assignees: readonly Assignment[], userId: string): boolean => assignees.length === 1 && assignees[0]!.userId === userId && assignees[0]!.type === 'PRIMARY';

/** A signature only moves to someone who does not sign the step yet (whatever the state of their signature). */
export const isSigner = (signatures: readonly Signature[], userId: string): boolean => signatures.some((signature) => signature.userId === userId);
