import type { Condition, ConditionValue, SubjectContext } from './subject-registry.js';

/** Closed set of placeholders; each one must be the entire value, never part of a string. */
const PLACEHOLDERS: Readonly<Record<string, (context: SubjectContext) => string | null | undefined>> = {
  '${user.id}': (context) => context.userId,
  '${membership.departmentId}': (context) => context.membership.departmentId,
  '${membership.siteId}': (context) => context.membership.siteId,
};

const OPERATORS = new Set(['equals', 'in', 'not']);
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export type TemplateResult =
  | { readonly valid: true; readonly condition: Condition }
  | { readonly valid: false; readonly reason: string };

type ValueResult = { readonly ok: true; readonly value: ConditionValue } | { readonly ok: false; readonly reason: string };

const invalid = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function resolveValue(value: unknown, context: SubjectContext): ValueResult {
  if (typeof value === 'string' && value.includes('${')) {
    const resolver = PLACEHOLDERS[value];
    if (resolver === undefined) return invalid(`unknown or embedded placeholder in "${value}"`);
    const resolved = resolver(context);
    // An unset placeholder must never become null: `{ departmentId: null }` matches every record without one.
    return resolved === undefined || resolved === null ? invalid(`placeholder ${value} has no value for this member`) : { ok: true, value: resolved };
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return { ok: true, value: value as ConditionValue };
  return invalid('values must be strings, numbers, booleans, null or placeholders');
}

function resolveOperand(operator: string, operand: unknown, context: SubjectContext): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (operator !== 'in') return resolveValue(operand, context);
  if (!Array.isArray(operand) || operand.length === 0) return invalid('"in" needs a non-empty list');
  const values: ConditionValue[] = [];
  for (const item of operand) {
    const resolved = resolveValue(item, context);
    if (!resolved.ok) return resolved;
    values.push(resolved.value);
  }
  return { ok: true, value: values };
}

function resolveField(field: string, raw: unknown, context: SubjectContext): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return resolveValue(raw, context);
  const entries = Object.entries(raw);
  if (entries.length === 0) return invalid(`field "${field}" has an empty operator object`);
  const resolved: Record<string, unknown> = {};
  for (const [operator, operand] of entries) {
    if (!OPERATORS.has(operator)) return invalid(`operator "${operator}" is not allowed`);
    const result = resolveOperand(operator, operand, context);
    if (!result.ok) return result;
    resolved[operator] = result.value;
  }
  return { ok: true, value: resolved };
}

/**
 * Validates a stored condition (a small Prisma `where` subset: fields of the subject with a value or
 * `equals` / `in` / `not`) and replaces the placeholders from the acting member, walking the parsed
 * JSON tree. Anything unexpected makes the whole rule invalid, and the caller drops it: a rule is
 * never widened, and no string replacement is ever done on JSON text.
 */
export function resolveConditionTemplate(template: unknown, allowedFields: ReadonlySet<string>, context: SubjectContext): TemplateResult {
  if (typeof template !== 'object' || template === null || Array.isArray(template)) {
    return { valid: false, reason: 'conditions must be a JSON object' };
  }
  const entries = Object.entries(template);
  if (entries.length === 0) return { valid: false, reason: 'conditions must not be empty' };
  const resolved: Record<string, unknown> = {};
  for (const [field, raw] of entries) {
    if (!FIELD_NAME.test(field) || !allowedFields.has(field)) return { valid: false, reason: `field "${field}" is not allowed` };
    const result = resolveField(field, raw, context);
    if (!result.ok) return { valid: false, reason: result.reason };
    resolved[field] = result.value;
  }
  return { valid: true, condition: resolved };
}
