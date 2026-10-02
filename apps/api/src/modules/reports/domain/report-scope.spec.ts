import { PermissionDeniedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { compileReportScope, intersectScopes } from './report-scope.js';

const A = '0199a000-0000-7000-8000-00000000000a';
const B = '0199a000-0000-7000-8000-00000000000b';

describe('compileReportScope', () => {
  it('a rule without conditions sees everything, whatever the others say', () => {
    expect(compileReportScope([{ conditions: { companyId: A } }, { conditions: undefined }])).toEqual({ kind: 'all' });
  });

  it('no rules sees nothing', () => expect(compileReportScope([])).toEqual({ kind: 'none' }));

  it('reads a value, null and the equals / in / not operators', () => {
    const scope = compileReportScope([{ conditions: { companyId: A, departmentId: { in: [A, B] }, siteId: { not: B }, workflowId: null } }]);
    expect(scope).toEqual({
      kind: 'restricted',
      anyOf: [[{ field: 'companyId', op: 'eq', values: [A] }, { field: 'departmentId', op: 'in', values: [A, B] }, { field: 'siteId', op: 'neq', values: [B] }, { field: 'workflowId', op: 'isNull', values: [] }]],
    });
    expect(compileReportScope([{ conditions: { siteId: { not: null }, companyId: { equals: A } } }])).toMatchObject({ anyOf: [[{ op: 'notNull' }, { op: 'eq' }]] });
  });

  it('several rules are alternatives', () => {
    expect(compileReportScope([{ conditions: { companyId: A } }, { conditions: { companyId: B } }])).toMatchObject({ anyOf: [[{ values: [A] }], [{ values: [B] }]] });
  });

  it.each([
    ['an unknown field', { status: 'OPEN' }],
    ['a value that is not a uuid', { companyId: "x' OR 1=1 --" }],
    ['a nested object', { companyId: { in: [{ a: 1 }] } }],
    ['an unknown operator', { companyId: { gt: A } }],
    ['an empty list', { companyId: { in: [] } }],
    ['two operators', { companyId: { in: [A], not: B } }],
    ['an array', [A]],
    ['an empty object', {}],
  ])('drops a rule with %s, so it can only narrow what is seen', (_label, conditions) => {
    expect(compileReportScope([{ conditions }])).toEqual({ kind: 'none' });
    expect(compileReportScope([{ conditions }, { conditions: { companyId: A } }])).toMatchObject({ anyOf: [[{ values: [A] }]] });
  });

  it('refuses a negated rule', () => {
    expect(() => compileReportScope([{ conditions: { companyId: A }, inverted: true }])).toThrow(PermissionDeniedError);
  });
});

describe('intersectScopes', () => {
  it('none wins, all yields the other, restricted ones are combined pairwise', () => {
    const left = compileReportScope([{ conditions: { companyId: A } }, { conditions: { companyId: B } }]);
    const right = compileReportScope([{ conditions: { siteId: A } }]);
    expect(intersectScopes({ kind: 'none' }, right)).toEqual({ kind: 'none' });
    expect(intersectScopes({ kind: 'all' }, right)).toEqual(right);
    expect(intersectScopes(left, { kind: 'all' })).toEqual(left);
    expect(intersectScopes(left, right)).toMatchObject({ anyOf: [[{ field: 'companyId', values: [A] }, { field: 'siteId' }], [{ field: 'companyId', values: [B] }, { field: 'siteId' }]] });
  });
});
