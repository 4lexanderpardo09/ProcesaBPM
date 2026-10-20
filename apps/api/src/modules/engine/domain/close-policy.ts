import { CloseNotAllowedError, CloseRequiredError, type DomainError, ExtraApprovalRequiredError, type StepDocument } from '@procesabpm/shared';

/** A step whose `close_rule` is REQUIRED can only be left by closing the ticket, never through a decision. */
export const leaveByDecisionRefusal = (step: StepDocument): DomainError | null => (step.closeRule === 'REQUIRED' ? new CloseRequiredError() : null);

/** Closing needs a step that allows it, and never skips an extra approval an amount cap demands. */
export function closeRefusal(step: StepDocument, divertsToUnvisitedApproval: boolean): DomainError | null {
  if (step.closeRule === 'NOT_ALLOWED') return new CloseNotAllowedError();
  return divertsToUnvisitedApproval ? new ExtraApprovalRequiredError() : null;
}

export function assertMayLeaveByDecision(step: StepDocument): void {
  const refusal = leaveByDecisionRefusal(step);
  if (refusal !== null) throw refusal;
}

export function assertMayClose(step: StepDocument, divertsToUnvisitedApproval: boolean): void {
  const refusal = closeRefusal(step, divertsToUnvisitedApproval);
  if (refusal !== null) throw refusal;
}
