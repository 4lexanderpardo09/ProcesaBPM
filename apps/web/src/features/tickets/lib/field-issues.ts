import { ApiError } from '@/shared/api';

/** What the API says is wrong with each field (`FIELD_VALUES_INVALID`), as a message key per field code. */
export type FieldIssueKey = 'REQUIRED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'TOO_MANY_DECIMALS' | 'NOT_AN_OPTION' | 'OTHER';

const KNOWN: ReadonlySet<string> = new Set(['REQUIRED', 'INVALID_TYPE', 'OUT_OF_RANGE', 'TOO_MANY_DECIMALS', 'NOT_AN_OPTION']);

/** The first issue of each field, or `undefined` when the error is not about field values. */
export function fieldIssuesOf(error: unknown): ReadonlyMap<string, FieldIssueKey> | undefined {
  if (!(error instanceof ApiError) || error.code !== 'FIELD_VALUES_INVALID') return undefined;
  const issues = (error.details as { issues?: unknown } | undefined)?.issues;
  const byField = new Map<string, FieldIssueKey>();
  if (!Array.isArray(issues)) return byField;
  for (const issue of issues as readonly { code?: unknown; fieldCode?: unknown }[]) {
    if (typeof issue.fieldCode !== 'string' || byField.has(issue.fieldCode)) continue;
    byField.set(issue.fieldCode, typeof issue.code === 'string' && KNOWN.has(issue.code) ? (issue.code as FieldIssueKey) : 'OTHER');
  }
  return byField;
}
