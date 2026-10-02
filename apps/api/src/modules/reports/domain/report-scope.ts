import { PermissionDeniedError } from '@procesabpm/shared';

/** Ticket fields a Report permission may be limited by. Anything else in a stored condition drops the rule. */
export const REPORT_SCOPE_FIELDS = ['companyId', 'departmentId', 'siteId', 'workflowId'] as const;
export type ReportScopeField = (typeof REPORT_SCOPE_FIELDS)[number];

export type ScopeOperator = 'eq' | 'in' | 'neq' | 'isNull' | 'notNull';

export interface ScopePredicate {
  readonly field: ReportScopeField;
  readonly op: ScopeOperator;
  readonly values: readonly string[];
}

/** What a member may see: everything, nothing, or the union of several conjunctions of predicates. */
export type ScopeSpec =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'restricted'; readonly anyOf: ReadonlyArray<readonly ScopePredicate[]> };

/** The part of a CASL rule this compiler reads. */
export interface ScopeRule {
  readonly conditions?: unknown;
  readonly inverted?: boolean | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isField = (name: string): name is ReportScopeField => (REPORT_SCOPE_FIELDS as readonly string[]).includes(name);
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function predicatesOf(conditions: unknown): ScopePredicate[] | undefined {
  if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) return undefined;
  const entries = Object.entries(conditions);
  if (entries.length === 0) return undefined;
  const predicates: ScopePredicate[] = [];
  for (const [field, raw] of entries) {
    if (!isField(field)) return undefined;
    const predicate = predicateOf(field, raw);
    if (predicate === undefined) return undefined;
    predicates.push(predicate);
  }
  return predicates;
}

function predicateOf(field: ReportScopeField, raw: unknown): ScopePredicate | undefined {
  if (raw === null) return { field, op: 'isNull', values: [] };
  if (isUuid(raw)) return { field, op: 'eq', values: [raw] };
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw);
  if (entries.length !== 1) return undefined;
  const [operator, operand] = entries[0]!;
  if (operator === 'equals') return operand === null ? { field, op: 'isNull', values: [] } : isUuid(operand) ? { field, op: 'eq', values: [operand] } : undefined;
  if (operator === 'not') return operand === null ? { field, op: 'notNull', values: [] } : isUuid(operand) ? { field, op: 'neq', values: [operand] } : undefined;
  if (operator === 'in' && Array.isArray(operand) && operand.length > 0 && operand.every(isUuid)) return { field, op: 'in', values: operand };
  return undefined;
}

/**
 * Turns the CASL rules a member holds for an action on `Report` into what the queries filter by. It fails closed:
 * a rule it does not fully understand is dropped (which can only narrow what is seen), no usable rule means nothing is
 * seen, and a rule that takes permission away cannot be expressed, so its presence is an error.
 */
export function compileReportScope(rules: readonly ScopeRule[]): ScopeSpec {
  if (rules.some((rule) => rule.inverted === true)) throw new PermissionDeniedError('Report permissions cannot be negated');
  if (rules.some((rule) => rule.conditions === undefined || rule.conditions === null)) return { kind: 'all' };
  const anyOf = rules.flatMap((rule) => {
    const predicates = predicatesOf(rule.conditions);
    return predicates === undefined ? [] : [predicates];
  });
  return anyOf.length === 0 ? { kind: 'none' } : { kind: 'restricted', anyOf };
}

/** Both actions must allow the row: the scope of an export is the narrowest of reading and exporting. */
export function intersectScopes(first: ScopeSpec, second: ScopeSpec): ScopeSpec {
  if (first.kind === 'none' || second.kind === 'none') return { kind: 'none' };
  if (first.kind === 'all') return second;
  if (second.kind === 'all') return first;
  return { kind: 'restricted', anyOf: first.anyOf.flatMap((left) => second.anyOf.map((right) => [...left, ...right])) };
}
