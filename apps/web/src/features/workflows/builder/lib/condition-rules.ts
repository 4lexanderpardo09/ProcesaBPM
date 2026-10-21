import { CONDITION_OPERATORS, type ConditionOperator, effectiveFieldType, type FieldDocument, operatorAppliesTo, OPERATOR_FIELD_TYPES, type TransitionCondition } from '@procesabpm/shared';

export type ConditionRule = TransitionCondition[number];
export type ValueKind = 'number' | 'date' | 'list' | 'option' | 'text';

const NUMERIC_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['gt', 'gte', 'lt', 'lte']);
const DATE_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['date_before', 'date_after', 'date_on_or_before', 'date_on_or_after']);

/** The operators that make sense for a field, in the order the engine lists them. */
export function operatorsFor(field: FieldDocument): ConditionOperator[] {
  const type = effectiveFieldType(field);
  return CONDITION_OPERATORS.filter((operator) => operatorAppliesTo(operator, type));
}

export function optionsOf(field: FieldDocument): ReadonlyArray<{ value: string; label: string }> {
  const options = field.config.options;
  return Array.isArray(options) ? (options as Array<{ value: string; label: string }>) : [];
}

/** How the value is typed for this field and operator: the engine compares numbers, dates and text differently. */
export function valueKind(field: FieldDocument, operator: ConditionOperator): ValueKind {
  if (operator === 'in_list') return 'list';
  if (NUMERIC_OPERATORS.has(operator)) return 'number';
  if (DATE_OPERATORS.has(operator)) return 'date';
  const type = effectiveFieldType(field);
  if (OPERATOR_FIELD_TYPES.numeric.has(type)) return 'number';
  if ((operator === 'equals' || operator === 'not_equals') && optionsOf(field).length > 0) return 'option';
  return 'text';
}

const today = () => new Date().toISOString().slice(0, 10);

/** A complete rule for a field just chosen: its first operator and a value of the right kind. */
export function ruleFor(field: FieldDocument): ConditionRule {
  const type = effectiveFieldType(field);
  if (OPERATOR_FIELD_TYPES.date.has(type)) return { field: field.code, op: 'date_on_or_after', value: today() };
  if (OPERATOR_FIELD_TYPES.numeric.has(type)) return { field: field.code, op: 'gt', value: 0 };
  return { field: field.code, op: 'equals', value: optionsOf(field)[0]?.value ?? '' };
}

/** Changing the operator keeps the value when it still fits, or gives one that does. */
export function withOperator(rule: ConditionRule, field: FieldDocument, operator: ConditionOperator): ConditionRule {
  const kind = valueKind(field, operator);
  const value = rule.value;
  if (kind === 'list') return { ...rule, op: operator, value: Array.isArray(value) ? value : [typeof value === 'boolean' ? String(value) : value] };
  const single = Array.isArray(value) ? (value[0] ?? '') : value;
  if (kind === 'number') return { ...rule, op: operator, value: typeof single === 'number' ? single : 0 };
  if (kind === 'date') return { ...rule, op: operator, value: typeof single === 'string' && /^\d{4}-\d{2}-\d{2}/.test(single) ? single : today() };
  if (kind === 'option') return { ...rule, op: operator, value: optionsOf(field).some((option) => option.value === single) ? String(single) : (optionsOf(field)[0]?.value ?? '') };
  return { ...rule, op: operator, value: typeof single === 'boolean' ? String(single) : single };
}

/** "a, b , c" as a list; numbers for a numeric field. An empty box is a list with an empty value (the schema needs one). */
export function parseList(text: string, numeric: boolean): Array<string | number> {
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return [''];
  return numeric ? parts.map((part) => (Number.isFinite(Number(part)) ? Number(part) : part)) : parts;
}
