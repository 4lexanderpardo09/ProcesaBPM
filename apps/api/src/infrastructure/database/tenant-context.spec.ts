import { MissingTenantContextError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { TenantContext } from './tenant-context.js';

const scopeA = { tenantId: 'tenant-a', userId: 'user-a' };
const scopeB = { tenantId: 'tenant-b', userId: 'user-b' };

describe('TenantContext', () => {
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
    expect(await Promise.all([read(scopeA, 20), read(scopeB, 1)])).toEqual(['tenant-a', 'tenant-b']);
  });

  it('restores the outer scope after a nested run()', () => {
    const context = new TenantContext();
    context.run(scopeA, () => {
      context.run(scopeB, () => expect(context.require()).toEqual(scopeB));
      expect(context.require()).toEqual(scopeA);
    });
  });
});
