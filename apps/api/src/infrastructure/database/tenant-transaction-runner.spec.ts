import { MissingTenantContextError, TenantContextMismatchError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner, type TenantTransaction } from './tenant-transaction-runner.js';

const scope = { tenantId: 'tenant-a', userId: 'user-a' };

function setup(applied: unknown = [{ tenant_id: scope.tenantId, user_id: scope.userId }]) {
  const queryRaw = vi.fn().mockResolvedValue(applied);
  const tx = { $queryRaw: queryRaw } as unknown as TenantTransaction;
  const transaction = vi.fn(async (work: (tx: TenantTransaction) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const context = new TenantContext();
  return { runner: new TenantTransactionRunner(prisma, context), context, transaction, queryRaw, tx };
}

describe('TenantTransactionRunner', () => {
  it('never opens a transaction without a tenant context', async () => {
    const { runner, transaction } = setup();
    const work = vi.fn();
    await expect(runner.withTenantTransaction(work)).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(transaction).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('fixes the tenant and user before running the work', async () => {
    const { runner, context, queryRaw, tx } = setup();
    const order: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push('set_config');
      expect(strings.join('?')).toContain("set_config('app.tenant_id', ?, true)");
      expect(strings.join('?')).toContain("set_config('app.user_id', ?, true)");
      expect(values).toEqual([scope.tenantId, scope.userId]);
      return [{ tenant_id: scope.tenantId, user_id: scope.userId }];
    });

    const result = await context.run(scope, () =>
      runner.withTenantTransaction(async (received) => {
        order.push('work');
        expect(received).toBe(tx);
        return 'done';
      }),
    );

    expect(result).toBe('done');
    expect(order).toEqual(['set_config', 'work']);
  });

  it.each([
    ['another tenant', [{ tenant_id: 'tenant-b', user_id: scope.userId }]],
    ['another user', [{ tenant_id: scope.tenantId, user_id: 'user-b' }]],
    ['an empty answer', []],
  ])('stops before the work when the database confirms %s', async (_label, applied) => {
    const { runner, context } = setup(applied);
    const work = vi.fn();
    await expect(context.run(scope, () => runner.withTenantTransaction(work))).rejects.toBeInstanceOf(
      TenantContextMismatchError,
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('propagates the errors of the work', async () => {
    const { runner, context } = setup();
    const failure = new Error('boom');
    await expect(context.run(scope, () => runner.withTenantTransaction(() => Promise.reject(failure)))).rejects.toBe(
      failure,
    );
  });
});
