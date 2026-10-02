import { MissingTenantContextError, TenantContextMismatchError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import type { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner, type TenantTransaction } from './tenant-transaction-runner.js';

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

function setup(applied: unknown = [{ tenant_id: scope.tenantId, user_id: scope.userId }]) {
  const queryRaw = vi.fn().mockResolvedValue(applied);
  const tx = { $queryRaw: queryRaw } as unknown as TenantTransaction;
  const transaction = vi.fn(async (work: (tx: TenantTransaction) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const context = new TenantContext();
  const config = { DB_TX_TIMEOUT_MS: 12_345, DB_TX_MAX_WAIT_MS: 678, DB_LOCK_TIMEOUT_MS: 4_321 } as AppConfig;
  return { runner: new TenantTransactionRunner(prisma, context, config), context, transaction, queryRaw, tx };
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
      expect(strings.join('?')).toContain("set_config('lock_timeout'");
      expect(strings.join('?')).toContain("set_config('statement_timeout'");
      expect(values).toEqual([scope.tenantId, scope.userId, '4321', '12345']);
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
    ['another tenant', [{ tenant_id: '22222222-2222-4222-8222-222222222222', user_id: scope.userId }]],
    ['another user', [{ tenant_id: scope.tenantId, user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }]],
    ['an empty answer', []],
  ])('stops before the work when the database confirms %s', async (_label, applied) => {
    const { runner, context } = setup(applied);
    const work = vi.fn();
    await expect(context.run(scope, () => runner.withTenantTransaction(work))).rejects.toBeInstanceOf(
      TenantContextMismatchError,
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('opens the transaction with the configured timeout and maximum wait', async () => {
    const { runner, context, transaction } = setup();
    await context.run(scope, () => runner.withTenantTransaction(async () => undefined));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 12_345, maxWait: 678 });
  });

  it('propagates the errors of the work', async () => {
    const { runner, context } = setup();
    const failure = new Error('boom');
    await expect(context.run(scope, () => runner.withTenantTransaction(() => Promise.reject(failure)))).rejects.toBe(
      failure,
    );
  });
});
