import { ApiError } from '@/shared/api';

/** What the API says is wrong with each field (`FIELD_VALUES_INVALID`), as a message key per field code. */
export type FieldIssueKey = 'REQUIRED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'TOO_MANY_DECIMALS' | 'NOT_AN_OPTION' | 'NOT_FOUND' | 'TOO_FEW_ROWS' | 'TOO_MANY_ROWS' | 'OTHER';

/** The first cell of a TABLE field the API rejects: its row (from 0, as sent) and column code. */
export interface CellIssue {
  readonly key: FieldIssueKey;
  readonly row: number;
  readonly column: string;
}

const KNOWN: ReadonlySet<string> = new Set(['REQUIRED', 'INVALID_TYPE', 'OUT_OF_RANGE', 'TOO_MANY_DECIMALS', 'NOT_AN_OPTION', 'NOT_FOUND', 'TOO_FEW_ROWS', 'TOO_MANY_ROWS']);

interface RawIssue {
  readonly code?: unknown;
  readonly fieldCode?: unknown;
  readonly row?: unknown;
  readonly column?: unknown;
}

const keyOf = (code: unknown): FieldIssueKey => (typeof code === 'string' && KNOWN.has(code) ? (code as FieldIssueKey) : 'OTHER');

function issuesOf(error: unknown): readonly RawIssue[] | undefined {
  if (!(error instanceof ApiError) || error.code !== 'FIELD_VALUES_INVALID') return undefined;
  const issues = (error.details as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) ? (issues as readonly RawIssue[]) : [];
}

/** The first issue of each field, or `undefined` when the error is not about field values. */
export function fieldIssuesOf(error: unknown): ReadonlyMap<string, FieldIssueKey> | undefined {
  const issues = issuesOf(error);
  if (issues === undefined) return undefined;
  const byField = new Map<string, FieldIssueKey>();
  for (const issue of issues) {
    if (typeof issue.fieldCode !== 'string' || byField.has(issue.fieldCode)) continue;
    byField.set(issue.fieldCode, keyOf(issue.code));
  }
  return byField;
}

/** The first rejected cell of each TABLE field, so the message can say which row and column. */
export function cellIssuesOf(error: unknown): ReadonlyMap<string, CellIssue> {
  const byField = new Map<string, CellIssue>();
  for (const issue of issuesOf(error) ?? []) {
    if (typeof issue.fieldCode !== 'string' || typeof issue.row !== 'number' || typeof issue.column !== 'string' || byField.has(issue.fieldCode)) continue;
    byField.set(issue.fieldCode, { key: keyOf(issue.code), row: issue.row, column: issue.column });
  }
  return byField;
}
