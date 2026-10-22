import { type DomainError, InvalidAssigneeError, InvalidReopenStepError, InvalidStateError, InvalidTransitionError, type StepDocument, type TicketActionsResponse } from '@procesabpm/shared';
import { closeRefusal, leaveByDecisionRefusal } from './close-policy.js';
import {
  actRefusal,
  type Assignment,
  commentRefusal,
  editRefusal,
  hasPendingSignature,
  type IncidentState,
  isEligibleAssignee,
  isSigner,
  isSoleHolder,
  openIncidentRefusal,
  openVisitRefusal,
  reassignRefusal,
  reopenRefusal,
  reportErrorRefusal,
  resolveIncidentRefusal,
  type Signature,
  signatureRefusal,
  takeRefusal,
  type TicketAction,
  type TicketStatus,
} from './ticket-action-rules.js';

/** Everything the action rules look at, read in one transaction for one caller. */
export interface TicketActionState {
  readonly actorId: string;
  readonly status: TicketStatus;
  readonly companyId: string;
  readonly visit: { readonly id: string; readonly stepId: string; readonly resumeAt: Date | null } | null;
  /** The step of the open visit, as the ticket's version defines it. */
  readonly step: StepDocument | undefined;
  /** Whether that step has a DECISION way out. */
  readonly hasDecisionExit: boolean;
  readonly assignees: readonly Assignment[];
  /** The signatures of the open visit (its step and loop). */
  readonly signatures: readonly Signature[];
  readonly openIncident: IncidentState | null;
  /** Whether the ticket went through a step for people it can be reopened into. */
  readonly hasReopenTarget: boolean;
  /** Each ticket permission, checked against this very ticket. */
  readonly grants: Readonly<Record<TicketAction, boolean>>;
}

export type TicketActionRefusals = { readonly [action in keyof TicketActionsResponse]: DomainError | null };

/**
 * What each action route would answer the caller right now, before reading its body: the same rules, in the same
 * order, as the engine service behind it. The client sends the visit it was shown, so the open one is assumed.
 */
export function ticketActionRefusals(state: TicketActionState): TicketActionRefusals {
  const { grants, step } = state;
  const ownType = state.assignees.find((assignee) => assignee.userId === state.actorId)?.type;
  const onOpenVisit = openVisitRefusal(state.status, state.visit, state.visit?.id ?? '');
  const parallel = step?.assignmentMode === 'PARALLEL';
  return {
    advance:
      onOpenVisit ??
      actRefusal('transition', { may: grants.transition, mayReassign: grants.reassign, ownType }) ??
      (step === undefined || !state.hasDecisionExit ? new InvalidTransitionError() : leaveByDecisionRefusal(step)),
    take: onOpenVisit ?? takeRefusal(grants.transition, ownType, state.assignees),
    reassign: onOpenVisit ?? reassignRefusal(grants.reassign) ?? (parallel && !hasPendingSignature(state.signatures) ? new InvalidAssigneeError() : null),
    close: onOpenVisit ?? actRefusal('close', { may: grants.close, mayReassign: grants.reassign, ownType }) ?? (step === undefined ? new InvalidStateError('The ticket is not on a step of its version') : closeRefusal(step, false)),
    openIncident: onOpenVisit ?? openIncidentRefusal(grants.open_incident, grants.reassign, ownType),
    resolveIncident: resolveIncidentRefusal({
      actorId: state.actorId,
      incident: state.openIncident,
      ticketStatus: state.status,
      hasOpenVisit: state.visit !== null,
      mayOpenIncident: grants.open_incident,
      mayReassign: grants.reassign,
    }),
    reopen: reopenRefusal(grants.reopen, state.status) ?? (state.hasReopenTarget ? null : new InvalidReopenStepError()),
    signParallelTask: onOpenVisit ?? signatureRefusal(parallel, state.signatures, state.actorId),
    comment: commentRefusal(grants.comment),
    reportError: onOpenVisit ?? reportErrorRefusal(grants.report_error),
    edit: editRefusal(grants.update, state.status),
  };
}

/** The actions the caller may take now: those no rule refuses. */
export function ticketActionsOf(state: TicketActionState): TicketActionsResponse {
  const refused = ticketActionRefusals(state);
  return {
    advance: refused.advance === null,
    take: refused.take === null,
    reassign: refused.reassign === null,
    close: refused.close === null,
    openIncident: refused.openIncident === null,
    resolveIncident: refused.resolveIncident === null,
    reopen: refused.reopen === null,
    signParallelTask: refused.signParallelTask === null,
    comment: refused.comment === null,
    reportError: refused.reportError === null,
    edit: refused.edit === null,
  };
}

/** Who the current step can be handed to: an active member of the ticket's company who would not leave it as it is. */
export function mayReceiveStep(state: TicketActionState, member: { readonly userId: string; readonly companyIds: readonly string[] }): boolean {
  if (!isEligibleAssignee(member, state.companyId)) return false;
  return state.step?.assignmentMode === 'PARALLEL' ? !isSigner(state.signatures, member.userId) : !isSoleHolder(state.assignees, member.userId);
}

/** Who an incident can be handed to: any active member of the ticket's company, the caller included. */
export const mayReceiveIncident = (state: TicketActionState, member: { readonly companyIds: readonly string[] }): boolean => isEligibleAssignee(member, state.companyId);
