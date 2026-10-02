import type { WorkflowVersionDocument } from './document.js';
import type { WorkflowProblem } from './problems.js';

const COMPUTED_TYPES = new Set(['FORMULA', 'CALCULATOR']);

/**
 * What the model allows but the engine does not run yet. A version with any of these is not publishable, so
 * a ticket never meets a block it cannot execute. Kept apart from `validateWorkflowGraph` (which checks the
 * design) because it shrinks as the engine learns features.
 */
export function findEngineSupportProblems(doc: WorkflowVersionDocument): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const error = (code: string, location: Partial<WorkflowProblem> = {}) => problems.push({ code, severity: 'error', ...location });
  const fieldByCode = new Map(doc.fields.map((field) => [field.code, field]));
  const computed = (code: string): boolean => COMPUTED_TYPES.has(fieldByCode.get(code)?.type ?? '');

  for (const step of doc.steps) {
    const at = { stepId: step.id };
    if (step.type === 'WAIT') error('NOT_IMPLEMENTED_WAIT_BLOCK', at);
    if (step.type === 'CALCULATOR') error('NOT_IMPLEMENTED_CALCULATOR_BLOCK', at);
    if (step.deadlineType === 'CUTOFF') error('NOT_IMPLEMENTED_CUTOFF_DEADLINE', at);
  }
  for (const transition of doc.transitions) {
    for (const rule of transition.condition ?? []) {
      if (computed(rule.field)) error('NOT_IMPLEMENTED_CONDITION_ON_COMPUTED_FIELD', { transitionId: transition.id, params: { code: rule.field } });
    }
  }
  for (const rule of doc.amountRules.filter((candidate) => candidate.isActive)) {
    const at = { amountRuleId: rule.id };
    if (computed(rule.fieldCode)) error('NOT_IMPLEMENTED_AMOUNT_RULE_ON_COMPUTED_FIELD', { ...at, params: { code: rule.fieldCode } });
    if (rule.action !== 'EXTRA_APPROVAL') continue;
    if (rule.stepId === null) error('AMOUNT_RULE_EXTRA_APPROVAL_NEEDS_STEP', at);
    else if (!doc.transitions.some((transition) => transition.type === 'SYSTEM_ONLY' && transition.fromStepId === rule.stepId && transition.toStepId === rule.approvalStepId)) {
      error('AMOUNT_RULE_EXTRA_APPROVAL_NOT_WIRED', at);
    }
  }
  return problems;
}
