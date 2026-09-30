export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'starts_with',
  'contains',
  'in_list',
  'gt',
  'gte',
  'lt',
  'lte',
  'date_before',
  'date_after',
  'date_on_or_before',
  'date_on_or_after',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ConditionValue = string | number | boolean | readonly (string | number)[];

export interface Condition {
  readonly field: string;
  readonly op: ConditionOperator;
  readonly value: ConditionValue;
}

/** Form values of a ticket keyed by field code. */
export type ConditionContext = Readonly<Record<string, unknown>>;
