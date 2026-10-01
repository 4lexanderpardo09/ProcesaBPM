import { InvalidTenantContextError, MissingTenantContextError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { TenantContext } from './tenant-context.js';

const scopeA = { tenantId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const scopeB = { tenantId: '22222222-2222-4222-8222-222222222222', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };

describe('TenantContext', () => {
  it.each([
    ['a tenantId that is not a UUID', { tenantId: 'tenant-1', userId: scopeA.userId }],
    ['a userId that is not a UUID', { tenantId: scopeA.tenantId, userId: 'user-1' }],
    ['an empty tenantId', { tenantId: '', userId: scopeA.userId }],
    ['an SQL injection attempt', { tenantId: "x'; DROP TABLE users;--", userId: scopeA.userId }],
    ['a UUID with extra characters', { tenantId: `${scopeA.tenantId} `, userId: scopeA.userId }],
  ])('refuses %s without running the work', (_label, scope) => {
    const context = new TenantContext();
    let ran = false;
    expect(() => context.run(scope, () => (ran = true))).toThrow(InvalidTenantContextError);
    expect(ran).toBe(false);
    expect(context.current()).toBeUndefined();
  });

  it('accepts UUIDv4 and UUIDv7', () => {
    const context = new TenantContext();
    const v7 = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
    expect(context.run({ tenantId: v7, userId: scopeA.userId }, () => context.require().tenantId)).toBe(v7);
  });

  it('has no scope outside run()', () => {
    const context = new TenantContext();
    expect(context.current()).toBeUndefined();
    expect(() => context.require()).toThrow(MissingTenantContextError);
  });

  it('exposes the scope inside run(), also across awaits', async () => {
    const context = new TenantContext();
    const seen = await context.run(scopeA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return context.require();
    });
    expect(seen).toEqual(scopeA);
    expect(context.current()).toBeUndefined();
  });

  it('keeps concurrent scopes apart', async () => {
    const context = new TenantContext();
    const read = (scope: typeof scopeA, delayMs: number) =>
      context.run(scope, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return context.require().tenantId;
      });
    expect(await Promise.all([read(scopeA, 20), read(scopeB, 1)])).toEqual(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
  });

  it('restores the outer scope after a nested run()', () => {
    const context = new TenantContext();
    context.run(scopeA, () => {
      context.run(scopeB, () => expect(context.require()).toEqual(scopeB));
      expect(context.require()).toEqual(scopeA);
    });
  });
});
