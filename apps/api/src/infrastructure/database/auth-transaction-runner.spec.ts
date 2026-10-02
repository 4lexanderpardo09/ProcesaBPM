import { InvalidTenantContextError, TenantContextMismatchError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { AuthTransactionRunner, type AuthTransaction } from './auth-transaction-runner.js';
import type { PrismaService } from './prisma.service.js';

const userId = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';

function setup(echo?: (values: unknown[]) => unknown) {
  const seen: unknown[][] = [];
  const queryRaw = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    seen.push(values);
    return echo ? echo(values) : [{ tenant_id: values[0], user_id: values[1] }];
  });
  const tx = { $queryRaw: queryRaw } as unknown as AuthTransaction;
  const transaction = vi.fn(async (work: (tx: AuthTransaction) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaService;
  const config = { DB_TX_TIMEOUT_MS: 1_000, DB_TX_MAX_WAIT_MS: 500, DB_LOCK_TIMEOUT_MS: 250 } as AppConfig;
  return { runner: new AuthTransactionRunner(prisma, config), seen, transaction };
}

describe('AuthTransactionRunner', () => {
  it('anonymous transactions set neither tenant nor user', async () => {
    const { runner, seen } = setup();
    await runner.withAnonymousTransaction(async () => undefined);
    expect(seen).toEqual([['', '', '250', '1000']]);
  });

  it('user transactions set the user and leave the tenant empty', async () => {
    const { runner, seen, transaction } = setup();
    await expect(runner.withUserTransaction(userId, async () => 'ok')).resolves.toBe('ok');
    expect(seen).toEqual([['', userId, '250', '1000']]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 1_000, maxWait: 500 });
  });

  it('refuses a user id that is not a UUID before opening a transaction', async () => {
    const { runner, transaction } = setup();
    await expect(runner.withUserTransaction('admin', async () => undefined)).rejects.toBeInstanceOf(
      InvalidTenantContextError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('stops when the database does not echo the requested scope', async () => {
    const { runner } = setup(() => [{ tenant_id: '', user_id: 'someone-else' }]);
    const work = vi.fn();
    await expect(runner.withUserTransaction(userId, work)).rejects.toBeInstanceOf(TenantContextMismatchError);
    expect(work).not.toHaveBeenCalled();
  });
});
