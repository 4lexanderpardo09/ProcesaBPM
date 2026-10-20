import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { fieldIssuesOf } from './field-issues';

const invalid = (issues: unknown) => new ApiError({ status: 422, code: 'FIELD_VALUES_INVALID', message: 'x', details: { issues } });

describe('fieldIssuesOf', () => {
  it('keeps the first issue of each field and names the unknown ones OTHER', () => {
    const issues = fieldIssuesOf(
      invalid([
        { code: 'REQUIRED', fieldCode: 'AMOUNT' },
        { code: 'OUT_OF_RANGE', fieldCode: 'AMOUNT' },
        { code: 'TOO_MANY_ROWS', fieldCode: 'ITEMS' },
      ]),
    );
    expect(Object.fromEntries(issues ?? [])).toEqual({ AMOUNT: 'REQUIRED', ITEMS: 'OTHER' });
  });

  it('is not about fields for any other error', () => {
    expect(fieldIssuesOf(new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'x' }))).toBeUndefined();
    expect(fieldIssuesOf(new Error('x'))).toBeUndefined();
  });
});
