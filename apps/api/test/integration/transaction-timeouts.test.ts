import { Test } from '@nestjs/testing';
import { mapDatabaseError, TemporarilyUnavailableError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { AppModule } from '../../src/app.module.js';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER } from '../../src/infrastructure/security/rate-limiter.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { connectTestDatabase } from '@procesabpm/db/testing/database';

/** A pool of one connection and a short transaction budget: the two ways Prisma's own transaction timeout shows up under load. */
useTestEnvironment({ DB_POOL_MAX: '1', DB_TX_MAX_WAIT_MS: '300', DB_TX_TIMEOUT_MS: '1500' } as never);

async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the work to fail');
}

describe('Prisma transaction timeouts reach the client as a retryable 503', () => {
  it('a transaction that cannot start in time (pool exhausted) is TEMPORARILY_UNAVAILABLE', async () => {
    const db = connectTestDatabase();
    const tenant = await seedTenant(db.platform);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).overrideProvider(RATE_LIMITER).useValue({ hit: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) }).compile();
    await moduleRef.init();
    try {
      const runner = moduleRef.get(TenantTransactionRunner);
      const context = moduleRef.get(TenantContext);
      await context.run({ tenantId: tenant.tenantId, userId: tenant.userId }, async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const holder = runner.withTenantTransaction(async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          await held;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const starved = await failureOf(() => runner.withTenantTransaction((tx) => tx.$queryRaw`SELECT 1`));
        release();
        await holder.catch(() => undefined);
        expect(mapDatabaseError(starved), String(starved)).toBeInstanceOf(TemporarilyUnavailableError);
      });

      await context.run({ tenantId: tenant.tenantId, userId: tenant.userId }, async () => {
        const expired = await failureOf(() =>
          runner.withTenantTransaction(async (tx) => {
            await tx.$queryRaw`SELECT 1`;
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            await tx.$queryRaw`SELECT 2`;
          }),
        );
        const message = expired instanceof Error ? `${expired.name} ${(expired as { code?: string }).code} ${expired.message}` : String(expired);
        expect(mapDatabaseError(expired), message).toBeInstanceOf(TemporarilyUnavailableError);
      });
    } finally {
      await moduleRef.close();
      await db.close();
    }
  });
});
