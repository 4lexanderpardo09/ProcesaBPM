import { PEOPLE_STEP_TYPES } from '../constants.js';
import { type RuleContext } from './context.js';

/** Amount caps point at fields and blocks of this version. */
export function checkAmountRules({ doc, stepById, fieldByCode, problems }: RuleContext): void {
  for (const rule of doc.amountRules) {
    if (!rule.isActive) continue;
    const at = { amountRuleId: rule.id };
    const field = fieldByCode.get(rule.fieldCode);
    if (field === undefined) problems.error('AMOUNT_RULE_UNKNOWN_FIELD', { ...at, params: { code: rule.fieldCode } });
    else if (field.type === 'TABLE') {
      const columns = Array.isArray(field.config.columns) ? (field.config.columns as Array<{ code: string }>).map((column) => column.code) : [];
      if (rule.amountColumn === null || !columns.includes(rule.amountColumn)) problems.error('AMOUNT_RULE_TABLE_COLUMN_UNKNOWN', { ...at, params: { column: rule.amountColumn ?? '' } });
      if (rule.typeColumn !== null && !columns.includes(rule.typeColumn)) problems.error('AMOUNT_RULE_TABLE_COLUMN_UNKNOWN', { ...at, params: { column: rule.typeColumn } });
    } else if (field.type !== 'NUMBER' && field.type !== 'CURRENCY') problems.error('AMOUNT_RULE_FIELD_NOT_NUMERIC', { ...at, params: { code: rule.fieldCode } });

    if (rule.stepId !== null && !stepById.has(rule.stepId)) problems.error('AMOUNT_RULE_STEP_NOT_IN_VERSION', at);
    if (rule.action === 'EXTRA_APPROVAL') {
      const approval = rule.approvalStepId === null ? undefined : stepById.get(rule.approvalStepId);
      if (approval === undefined) problems.error('AMOUNT_RULE_APPROVAL_STEP_MISSING', at);
      else {
        if (!PEOPLE_STEP_TYPES.has(approval.type)) problems.error('AMOUNT_RULE_APPROVAL_STEP_NOT_PEOPLE', { ...at, stepId: approval.id });
        if (!doc.transitions.some((transition) => transition.type === 'SYSTEM_ONLY' && transition.toStepId === approval.id)) problems.warning('AMOUNT_RULE_APPROVAL_STEP_NOT_WIRED', { ...at, stepId: approval.id });
      }
    }
  }
}
