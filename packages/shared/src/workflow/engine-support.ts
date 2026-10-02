import type { WorkflowVersionDocument } from './document.js';
import type { WorkflowProblem } from './problems.js';

/**
 * What the model allows but the engine does not run yet. A version with any of these is not publishable, so
 * a ticket never meets a block it cannot execute. Kept apart from `validateWorkflowGraph` (which checks the
 * design) because it shrinks as the engine learns features.
 */
export function findEngineSupportProblems(doc: WorkflowVersionDocument): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const error = (code: string, location: Partial<WorkflowProblem> = {}) => problems.push({ code, severity: 'error', ...location });

  for (const step of doc.steps) {
    const at = { stepId: step.id };
    if (step.type === 'WAIT') error('NOT_IMPLEMENTED_WAIT_BLOCK', at);
    if (step.type === 'NOTIFICATION') error('NOT_IMPLEMENTED_NOTIFICATION_BLOCK', at);
    if (step.type === 'WEBHOOK') error('NOT_IMPLEMENTED_WEBHOOK_BLOCK', at);
    if (step.type === 'EXPORT') error('NOT_IMPLEMENTED_EXPORT_BLOCK', at);
    if (step.deadlineType === 'CUTOFF') error('NOT_IMPLEMENTED_CUTOFF_DEADLINE', at);
  }
  for (const rule of doc.amountRules.filter((candidate) => candidate.isActive)) {
    const at = { amountRuleId: rule.id };
    if (rule.action !== 'EXTRA_APPROVAL') continue;
    if (rule.stepId === null) error('AMOUNT_RULE_EXTRA_APPROVAL_NEEDS_STEP', at);
    else if (!doc.transitions.some((transition) => transition.type === 'SYSTEM_ONLY' && transition.fromStepId === rule.stepId && transition.toStepId === rule.approvalStepId)) {
      error('AMOUNT_RULE_EXTRA_APPROVAL_NOT_WIRED', at);
    }
  }
  return problems;
}
