import { operatorAppliesTo, transitionConditionSchema } from '../transition-condition.js';
import { type RuleContext } from './context.js';

/**
 * The rules of CONDITION transitions read field codes. A field is *available* at the condition block when
 * the field's block is on every path to it (dominates it); *maybe unset* when it is only on some path
 * (a warning); anything else (a later block, another branch) is an error.
 */
export function checkConditions({ doc, graph, stepById, fieldByCode, reachable, problems }: RuleContext): void {
  const ancestors = new Map<string, Set<string>>();
  const ancestorsOf = (id: string): Set<string> => {
    if (!ancestors.has(id)) ancestors.set(id, graph.ancestorsOf(id));
    return ancestors.get(id)!;
  };
  for (const transition of doc.transitions) {
    if (transition.type !== 'CONDITION' || transition.condition === null) continue;
    const at = { transitionId: transition.id };
    const parsed = transitionConditionSchema.safeParse(transition.condition);
    if (!parsed.success) {
      problems.error('CONDITION_INVALID', { ...at, params: { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) } });
      continue;
    }
    for (const rule of parsed.data) {
      const field = fieldByCode.get(rule.field);
      if (field === undefined) {
        problems.error('CONDITION_UNKNOWN_FIELD', { ...at, params: { code: rule.field } });
        continue;
      }
      if (!operatorAppliesTo(rule.op, field.type)) problems.error('CONDITION_OPERATOR_TYPE_MISMATCH', { ...at, params: { code: rule.field, operator: rule.op, fieldType: field.type } });
      if (!stepById.has(field.stepId) || !reachable.has(transition.fromStepId)) continue;
      if (graph.dominates(field.stepId, transition.fromStepId)) continue;
      if (ancestorsOf(transition.fromStepId).has(field.stepId)) problems.warning('CONDITION_FIELD_MAYBE_UNSET', { ...at, params: { code: rule.field } });
      else problems.error('CONDITION_FIELD_NOT_EARLIER', { ...at, params: { code: rule.field } });
    }
  }
}
