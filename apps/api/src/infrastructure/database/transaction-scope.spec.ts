import type { Prisma } from '@procesabpm/db';
import { describe, expectTypeOf, it } from 'vitest';
import type { AuthTransaction, CrossTenantTransaction, PlatformTransaction, TenantTransaction } from './transaction-scope.js';

describe('transaction scopes', () => {
  it('are not interchangeable (a compile error, checked by typecheck)', () => {
    expectTypeOf<PlatformTransaction>().not.toExtend<TenantTransaction>();
    expectTypeOf<TenantTransaction>().not.toExtend<PlatformTransaction>();
    expectTypeOf<AuthTransaction>().not.toExtend<TenantTransaction>();
    expectTypeOf<TenantTransaction>().not.toExtend<AuthTransaction>();
    expectTypeOf<CrossTenantTransaction>().not.toExtend<TenantTransaction>();
    expectTypeOf<TenantTransaction>().not.toExtend<CrossTenantTransaction>();
    expectTypeOf<AuthTransaction>().not.toExtend<CrossTenantTransaction>();
    expectTypeOf<CrossTenantTransaction>().not.toExtend<AuthTransaction>();
    expectTypeOf<PlatformTransaction>().not.toExtend<AuthTransaction>();
    expectTypeOf<PlatformTransaction>().not.toExtend<CrossTenantTransaction>();
    expectTypeOf<Prisma.TransactionClient>().not.toExtend<TenantTransaction>();
  });

  it('keep every Prisma client method available', () => {
    expectTypeOf<TenantTransaction>().toExtend<Prisma.TransactionClient>();
    expectTypeOf<PlatformTransaction>().toExtend<Prisma.TransactionClient>();
  });
});
