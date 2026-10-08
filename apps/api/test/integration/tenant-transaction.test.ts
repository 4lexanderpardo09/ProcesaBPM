import { Test } from '@nestjs/testing';
import { InvalidStateError, MissingTenantContextError, mapDatabaseError } from '@procesabpm/shared';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedDraftWorkflow, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../src/infrastructure/database/tenant-transaction-runner.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('TenantTransactionRunner against PostgreSQL', () => {
  let db: TestDatabase;
  let moduleRef: Awaited<ReturnType<typeof compile>>;
  let runner: TenantTransactionRunner;
  let context: TenantContext;
  let prisma: PrismaService;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const compile = () => Test.createTestingModule({ imports: [AppModule] }).compile();
  const asTenant = <T>(tenant: SeededTenant, work: () => Promise<T>) =>
    context.run({ tenantId: tenant.tenantId, userId: tenant.userId }, work);

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    moduleRef = await compile();
    await moduleRef.init();
    runner = moduleRef.get(TenantTransactionRunner);
    context = moduleRef.get(TenantContext);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await db.close();
  });

  it('fixes the tenant: queries only see its own rows', async () => {
    const rows = await asTenant(tenantA, () => runner.withTenantTransaction((tx) => tx.company.findMany()));
    expect(rows.map((row) => row.tenantId)).toEqual([tenantA.tenantId]);
  });

  it('reports the user it acts for', async () => {
    const [row] = await asTenant(tenantB, () =>
      runner.withTenantTransaction((tx) => tx.$queryRaw<{ tenant: string; user: string }[]>`
        SELECT current_setting('app.tenant_id') AS tenant, current_setting('app.user_id') AS "user"`),
    );
    expect(row).toEqual({ tenant: tenantB.tenantId, user: tenantB.userId });
  });

  it('fails without a tenant context and never reaches the database', async () => {
    let ran = false;
    await expect(
      runner.withTenantTransaction(async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(ran).toBe(false);
  });

  it('does not leave the tenant on the pooled connection after the transaction', async () => {
    await asTenant(tenantA, () => runner.withTenantTransaction((tx) => tx.company.findMany()));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const [setting] = await prisma.$queryRaw<{ tenant: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS tenant`;
      expect(setting?.tenant ?? '').toBe('');
    }
    expect(await prisma.company.findMany()).toEqual([]);
  });

  it('keeps two tenants apart under parallel load (tenant leak test)', async () => {
    const leaks: string[] = [];
    const worker = (tenant: SeededTenant, other: SeededTenant, id: number) =>
      (async () => {
        for (let round = 0; round < 25; round += 1) {
          const rows = await asTenant(tenant, () =>
            runner.withTenantTransaction(async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(${Math.random() * 0.01})`;
              return tx.company.findMany({ select: { tenantId: true } });
            }),
          );
          if (rows.length !== 1 || rows.some((row) => row.tenantId !== tenant.tenantId || row.tenantId === other.tenantId)) {
            leaks.push(`worker ${id} round ${round}: ${JSON.stringify(rows)}`);
          }
        }
      })();

    await Promise.all(
      Array.from({ length: 6 }, (_, id) => (id % 2 === 0 ? worker(tenantA, tenantB, id) : worker(tenantB, tenantA, id))),
    );
    expect(leaks).toEqual([]);
  });

  it('cannot write into another tenant', async () => {
    const error = await asTenant(tenantA, () =>
      runner.withTenantTransaction((tx) =>
        tx.company.create({
          data: { tenantId: tenantB.tenantId, name: 'intruder', countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota' },
        }),
      ),
    ).catch((caught: unknown) => caught);
    expect(mapDatabaseError(error)?.code).toBe('PERMISSION_DENIED');
  });

  it('never selects the sensitive columns of users', async () => {
    const users = await asTenant(tenantA, () => runner.withTenantTransaction((tx) => tx.user.findMany()));
    expect(users).not.toHaveLength(0);
    for (const user of users) {
      expect(Object.keys(user)).not.toEqual(expect.arrayContaining(['passwordHash']));
      expect(user).not.toHaveProperty('mfaSecretEncrypted');
      expect(user).not.toHaveProperty('failedLogins');
      expect(user).not.toHaveProperty('lockedUntil');
    }
  });

  it('translates a trigger violation (23514) to InvalidStateError', async () => {
    const workflow = await seedDraftWorkflow(db.platform, tenantA);
    const error = await asTenant(tenantA, () =>
      runner.withTenantTransaction((tx) => tx.$executeRaw`UPDATE steps SET type = 'TASK' WHERE id = ${workflow.startStepId}::uuid`),
    ).catch((caught: unknown) => caught);
    expect(mapDatabaseError(error)).toBeInstanceOf(InvalidStateError);
  });

  it('translates a rule checked at COMMIT (deferred 23514) to InvalidStateError', async () => {
    const orphanUser = await insertReturningId(
      db.platform,
      `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Orphan', 'User') RETURNING id`,
      [`orphan-${Date.now()}@example.com`],
    );
    // A new membership starts INVITED (S1); activating it without a company is what the
    // deferred rule checks at COMMIT, so the two statements go in the same transaction.
    const error = await asTenant(tenantA, () =>
      runner.withTenantTransaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO memberships (tenant_id, user_id, role_id, status)
                             VALUES (${tenantA.tenantId}::uuid, ${orphanUser}::uuid, ${tenantA.roleId}::uuid, 'INVITED')`;
        await tx.$executeRaw`UPDATE memberships SET status = 'ACTIVE'
                             WHERE tenant_id = ${tenantA.tenantId}::uuid AND user_id = ${orphanUser}::uuid`;
      }),
    ).catch((caught: unknown) => caught);
    expect(mapDatabaseError(error)).toBeInstanceOf(InvalidStateError);
  });
});
