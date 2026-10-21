import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { cellIssuesOf, fieldIssuesOf } from './field-issues';

const invalid = (issues: unknown) => new ApiError({ status: 422, code: 'FIELD_VALUES_INVALID', message: 'x', details: { issues } });

describe('fieldIssuesOf', () => {
  it('keeps the first issue of each field and names the unknown ones OTHER', () => {
    const issues = fieldIssuesOf(
      invalid([
        { code: 'REQUIRED', fieldCode: 'AMOUNT' },
        { code: 'OUT_OF_RANGE', fieldCode: 'AMOUNT' },
        { code: 'TOO_MANY_ROWS', fieldCode: 'ITEMS' },
        { code: 'NOT_FOUND', fieldCode: 'AUDITOR' },
        { code: 'FORMULA_ERROR', fieldCode: 'TOTAL' },
      ]),
    );
    expect(Object.fromEntries(issues ?? [])).toEqual({ AMOUNT: 'REQUIRED', ITEMS: 'TOO_MANY_ROWS', AUDITOR: 'NOT_FOUND', TOTAL: 'OTHER' });
  });

  it('is not about fields for any other error', () => {
    expect(fieldIssuesOf(new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'x' }))).toBeUndefined();
    expect(fieldIssuesOf(new Error('x'))).toBeUndefined();
  });
});

describe('cellIssuesOf', () => {
  it('keeps the first rejected cell of each table', () => {
    const cells = cellIssuesOf(
      invalid([
        { code: 'AMOUNT', fieldCode: 'NOTES' },
        { code: 'REQUIRED', fieldCode: 'ITEMS', row: 1, column: 'qty' },
        { code: 'INVALID_TYPE', fieldCode: 'ITEMS', row: 2, column: 'price' },
      ]),
    );
    expect(Object.fromEntries(cells)).toEqual({ ITEMS: { key: 'REQUIRED', row: 1, column: 'qty' } });
    expect(cellIssuesOf(new Error('x')).size).toBe(0);
  });
});
