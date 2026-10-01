import { describe, expect, it } from 'vitest';
import { resolveConditionTemplate } from './condition-template.js';
import type { SubjectContext } from './subject-registry.js';

const fields = new Set(['ownerId', 'departmentId', 'status']);
const context: SubjectContext = { userId: 'user-1', membership: { departmentId: 'dept-1', siteId: null } };
const resolve = (template: unknown, ctx = context) => resolveConditionTemplate(template, fields, ctx);

describe('resolveConditionTemplate', () => {
  it.each([
    ['a literal', { status: 'OPEN' }, { status: 'OPEN' }],
    ['a number, a boolean and null', { status: 3, ownerId: null }, { status: 3, ownerId: null }],
    ['the user placeholder', { ownerId: '${user.id}' }, { ownerId: 'user-1' }],
    ['the department placeholder', { departmentId: '${membership.departmentId}' }, { departmentId: 'dept-1' }],
    ['equals', { status: { equals: 'OPEN' } }, { status: { equals: 'OPEN' } }],
    ['not with a placeholder', { ownerId: { not: '${user.id}' } }, { ownerId: { not: 'user-1' } }],
    ['in with literals and a placeholder', { departmentId: { in: ['d9', '${membership.departmentId}'] } }, { departmentId: { in: ['d9', 'dept-1'] } }],
    ['several fields', { status: 'OPEN', ownerId: '${user.id}' }, { status: 'OPEN', ownerId: 'user-1' }],
  ])('resolves %s', (_label, template, expected) => {
    expect(resolve(template)).toEqual({ valid: true, condition: expected });
  });

  it.each([
    ['a field outside the whitelist', { password: 'x' }],
    ['a Prisma operator that is not allowed', { status: { contains: 'x' } }],
    ['a logical operator as a field', { OR: [{ status: 'OPEN' }] }],
    ['a nested relation filter', { status: { some: { id: '1' } } }],
    ['a placeholder embedded in a string', { ownerId: 'x-${user.id}' }],
    ['an unknown placeholder', { ownerId: '${user.password}' }],
    ['a placeholder with extra text', { ownerId: '${user.id} ' }],
    ['a template expression in a literal', { status: '${process.env.SECRET}' }],
    ['an empty object', {}],
    ['an empty operator object', { status: {} }],
    ['an empty "in" list', { status: { in: [] } }],
    ['"in" with something that is not a list', { status: { in: 'OPEN' } }],
    ['an object as a value', { status: { equals: { a: 1 } } }],
    ['an array as the whole condition', [{ status: 'OPEN' }]],
    ['a string as the whole condition', 'status=OPEN'],
    ['a field name that is not an identifier', { 'status; DROP TABLE x': 'a' }],
  ])('rejects %s', (_label, template) => {
    expect(resolve(template).valid).toBe(false);
  });

  it.each([
    ['null', { userId: 'user-1', membership: { departmentId: null } }],
    ['undefined', { userId: 'user-1', membership: {} }],
  ])('rejects the rule when a placeholder resolves to %s (never turns it into null)', (_label, ctx) => {
    const result = resolve({ departmentId: '${membership.departmentId}' }, ctx);
    expect(result).toEqual({ valid: false, reason: expect.stringContaining('has no value') });
  });

  it('rejects the whole rule when one placeholder inside "in" has no value', () => {
    expect(resolve({ departmentId: { in: ['d1', '${membership.siteId}'] } }).valid).toBe(false);
  });

  it('does not touch the template it was given', () => {
    const template = { ownerId: '${user.id}' };
    resolve(template);
    expect(template).toEqual({ ownerId: '${user.id}' });
  });
});
