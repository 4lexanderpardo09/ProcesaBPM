import { z } from 'zod';
import { CONDITION_OPERATORS, type ConditionOperator } from '../engine/conditions/types.js';
import { FIELD_CODE_PATTERN } from './constants.js';

const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const NUMERIC_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['gt', 'gte', 'lt', 'lte']);
const DATE_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['date_before', 'date_after', 'date_on_or_before', 'date_on_or_after']);
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

export const conditionRuleSchema = z
  .object({
    field: z.string().regex(FIELD_CODE_PATTERN),
    op: z.enum(CONDITION_OPERATORS),
    value: z.union([scalar, z.array(z.union([z.string().max(1000), z.number().finite()])).min(1).max(200)]),
  })
  .strict()
  .superRefine((rule, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message, path: ['value'] });
    if (rule.op === 'in_list') {
      if (!Array.isArray(rule.value)) fail('in_list needs a non-empty list');
    } else if (Array.isArray(rule.value)) {
      fail('only in_list takes a list');
    } else if (NUMERIC_OPERATORS.has(rule.op) && typeof rule.value !== 'number') {
      fail('this operator needs a number');
    } else if (DATE_OPERATORS.has(rule.op) && !(typeof rule.value === 'string' && DATE_VALUE.test(rule.value))) {
      fail('this operator needs a date (YYYY-MM-DD) or an ISO datetime');
    }
  });

/** The branch rule of a CONDITION transition: rules evaluated with AND (the same shape `engine/conditions` evaluates). */
export const transitionConditionSchema = z.array(conditionRuleSchema).min(1).max(20);
export type TransitionCondition = z.infer<typeof transitionConditionSchema>;

/** Which operators apply to which field types (the evaluator would otherwise compare apples to oranges). */
export const OPERATOR_FIELD_TYPES: Readonly<Record<'numeric' | 'date' | 'text', ReadonlySet<string>>> = {
  numeric: new Set(['NUMBER', 'CURRENCY', 'DAYS', 'FORMULA', 'CALCULATOR']),
  date: new Set(['DATE', 'DATETIME']),
  text: new Set(['TEXT', 'TEXTAREA', 'SELECT', 'MULTI_SELECT', 'SITE', 'USER']),
};

export function operatorAppliesTo(op: ConditionOperator, fieldType: string): boolean {
  if (NUMERIC_OPERATORS.has(op)) return OPERATOR_FIELD_TYPES.numeric.has(fieldType);
  if (DATE_OPERATORS.has(op)) return OPERATOR_FIELD_TYPES.date.has(fieldType);
  // equals, not_equals, starts_with, contains, in_list work on anything that holds a scalar.
  return OPERATOR_FIELD_TYPES.text.has(fieldType) || OPERATOR_FIELD_TYPES.numeric.has(fieldType) || OPERATOR_FIELD_TYPES.date.has(fieldType);
}
