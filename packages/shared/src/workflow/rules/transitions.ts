import { DEFAULT_EXIT_STEP_TYPES, PEOPLE_STEP_TYPES, isAutomaticStep } from '../constants.js';
import { type RuleContext } from './context.js';

/** Each transition against the rules the database enforces (`validate_transition`, unique indexes), and the exits every block needs. */
export function checkTransitions({ doc, stepById, transitionsFrom, problems }: RuleContext): void {
  const defaultsSeen = new Set<string>();
  const labelsSeen = new Set<string>();
  for (const transition of doc.transitions) {
    const at = { transitionId: transition.id };
    const from = stepById.get(transition.fromStepId);
    const to = stepById.get(transition.toStepId);
    if (from === undefined || to === undefined) {
      problems.error('TRANSITION_UNKNOWN_BLOCK', at);
      continue;
    }
    if (from.type === 'END') problems.error('TRANSITION_FROM_END', at);
    if (to.type === 'START') problems.error('TRANSITION_TO_START', at);
    const wrongType =
      (transition.type === 'CONDITION' && from.type !== 'CONDITION') ||
      (transition.type === 'DEFAULT' && !isAutomaticStep(from.type)) ||
      (transition.type === 'DECISION' && isAutomaticStep(from.type)) ||
      (from.type === 'CONDITION' && transition.type === 'DECISION');
    if (wrongType) problems.error('TRANSITION_TYPE_NOT_ALLOWED', at);
    if ((transition.type === 'CONDITION') !== (transition.condition !== null)) problems.error('CONDITION_RULE_MISSING', at);
    if (transition.type === 'DEFAULT') {
      if (defaultsSeen.has(from.id)) problems.error('TRANSITION_DUPLICATE_DEFAULT', at);
      defaultsSeen.add(from.id);
    }
    const labelKey = `${from.id}\u0000${transition.label.trim().toLowerCase()}`;
    if (labelsSeen.has(labelKey)) problems.error('TRANSITION_LABEL_DUPLICATE', { ...at, params: { label: transition.label } });
    labelsSeen.add(labelKey);
  }

  for (const step of doc.steps) {
    const exits = transitionsFrom.get(step.id) ?? [];
    const of = (type: string) => exits.filter((exit) => exit.type === type).length;
    const at = { stepId: step.id };
    if (DEFAULT_EXIT_STEP_TYPES.has(step.type) && of('DEFAULT') === 0) problems.error('AUTOMATIC_BLOCK_WITHOUT_DEFAULT', at);
    if (step.type === 'CONDITION') {
      if (of('DEFAULT') === 0) problems.error('CONDITION_WITHOUT_DEFAULT', at);
      if (of('CONDITION') === 0) problems.warning('CONDITION_WITHOUT_BRANCHES', at);
    }
    if (PEOPLE_STEP_TYPES.has(step.type)) {
      if (of('DECISION') === 0) problems.error('PEOPLE_BLOCK_WITHOUT_DECISION', at);
      else if (step.type === 'DECISION' && of('DECISION') === 1) problems.warning('DECISION_BLOCK_SINGLE_EXIT', at);
    }
  }
}
