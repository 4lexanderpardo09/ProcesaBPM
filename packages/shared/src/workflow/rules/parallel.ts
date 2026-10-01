import { type RuleContext } from './context.js';

/** The longest wait between two hand-outs of a RANDOM_DISPATCH step that is still sensible (a day). */
export const MAX_DISPATCH_INTERVAL_MIN = 1440;

/** What PARALLEL steps need to run (one way out when everybody signed, at most one when somebody rejects) and RANDOM_DISPATCH sanity. */
export function checkAssignmentModes({ doc, transitionsFrom, problems }: RuleContext): void {
  for (const step of doc.steps) {
    const at = { stepId: step.id };
    if (step.assignmentMode === 'RANDOM_DISPATCH' && step.dispatchIntervalMin !== null && step.dispatchIntervalMin > MAX_DISPATCH_INTERVAL_MIN) {
      problems.warning('RANDOM_DISPATCH_INTERVAL_TOO_LONG', { ...at, params: { minutes: step.dispatchIntervalMin } });
    }
    if (step.assignmentMode !== 'PARALLEL') continue;

    const exits = transitionsFrom.get(step.id) ?? [];
    if (exits.filter((exit) => exit.type === 'DECISION').length !== 1) problems.error('PARALLEL_DECISION_EXIT_COUNT', at);
    if (exits.filter((exit) => exit.type === 'SYSTEM_ONLY').length > 1) problems.error('PARALLEL_REJECTION_EXIT_COUNT', at);
    if (doc.fields.some((field) => field.stepId === step.id && field.capture !== 'CREATION')) problems.error('PARALLEL_STEP_WITH_FIELDS', at);
    if (doc.amountRules.some((rule) => rule.isActive && rule.stepId === step.id)) problems.error('AMOUNT_RULE_ON_PARALLEL_STEP', at);
    if (step.closeRule !== 'NOT_ALLOWED') problems.error('PARALLEL_STEP_CLOSE_RULE', at);
    if (step.signers.some((signer) => signer.signerType === 'STEP_ASSIGNEE')) problems.error('PARALLEL_SIGNER_TYPE_NOT_ALLOWED', at);
    if (step.signers.some((signer) => signer.signerType === 'APPROVER') && (step.approvalGroupTypeId === null || step.approvalLevel === null)) problems.error('PARALLEL_APPROVER_CONFIG_MISSING', at);
  }
}
