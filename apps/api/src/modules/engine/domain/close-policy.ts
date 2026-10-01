import { CloseNotAllowedError, CloseRequiredError, ExtraApprovalRequiredError, type StepDocument } from '@procesabpm/shared';

/** A step whose `close_rule` is REQUIRED can only be left by closing the ticket, never through a decision. */
export function assertMayLeaveByDecision(step: StepDocument): void {
  if (step.closeRule === 'REQUIRED') throw new CloseRequiredError();
}

/** Closing needs a step that allows it, and never skips an extra approval an amount cap demands. */
export function assertMayClose(step: StepDocument, divertsToUnvisitedApproval: boolean): void {
  if (step.closeRule === 'NOT_ALLOWED') throw new CloseNotAllowedError();
  if (divertsToUnvisitedApproval) throw new ExtraApprovalRequiredError();
}
