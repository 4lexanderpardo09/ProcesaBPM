import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@procesabpm/db';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { mapDatabaseError } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Proof of concept for prisma/orm#30374: after a database error inside an interactive
 * transaction with `@prisma/adapter-pg`, later queries could receive the answers of other queries.
 * For a multi-tenant system that would mean one tenant reading another tenant's rows.
 *
 * Every worker alternates failing transactions with transactions that must read back exactly the
 * markers and rows of their own tenant. Small pools force the same connection to be reused right
 * after an error, which is the worst case. A single mixed-up answer fails the test.
 */

type Tx = Prisma.TransactionClient;
type Failure = (tx: Tx, tenant: SeededTenant) => Promise<unknown>;

const ROUNDS_PER_WORKER = 40;
const WORKERS_PER_TENANT = 4;
const POOL_SIZES = [1, 2, 5];

const readMarker = (tx: Tx, marker: string) =>
  tx.$queryRaw<{ marker: string; tenant: string | null }[]>`
    SELECT ${marker}::text AS marker, current_setting('app.tenant_id', true) AS tenant`;

/** Database errors of different kinds, all raised inside an interactive transaction. */
const FAILURES: Record<string, Failure> = {
  'unique violation (23505)': (tx, tenant) =>
    tx.company.create({
      data: { tenantId: tenant.tenantId, name: 'second default', isDefault: true, countryCode: 'CO', currencyCode: 'COP', timeZone: 'America/Bogota' },
    }),
  'check violation (23514)': (tx, tenant) =>
    tx.$executeRaw`INSERT INTO companies (tenant_id, name, country_code, currency_code, time_zone)
                   VALUES (${tenant.tenantId}::uuid, 'bad zone', 'CO', 'COP', 'Mars/Olympus')`,
  'foreign key violation (23503)': (tx, tenant) =>
    tx.$executeRaw`INSERT INTO membership_companies (tenant_id, user_id, company_id)
                   VALUES (${tenant.tenantId}::uuid, gen_random_uuid(), ${tenant.companyId}::uuid)`,
  'missing privilege (42501)': (tx) => tx.$executeRaw`DELETE FROM audit_logs`,
  'syntax error (42601)': (tx) => tx.$queryRawUnsafe('SELEC 1'),
  'runtime error (22012)': (tx) => tx.$queryRaw`SELECT 1 / 0`,
};
const FAILURE_NAMES = Object.keys(FAILURES);

type Mode = 'throw' | 'catch and keep querying' | 'failing query in parallel with another' | 'timeout while a query runs';
const MODES: Mode[] = ['throw', 'catch and keep querying', 'failing query in parallel with another', 'timeout while a query runs'];

describe('prisma/orm#30374: answers after a database error inside an interactive transaction', () => {
  let db: TestDatabase;
  let tenants: SeededTenant[];

  beforeAll(async () => {
    db = connectTestDatabase();
    tenants = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  const inTenant = <T>(prisma: PrismaClient, tenantId: string, work: (tx: Tx) => Promise<T>, timeout?: number) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return work(tx);
      },
      timeout === undefined ? undefined : { timeout },
    );

  async function failingTransaction(prisma: PrismaClient, tenant: SeededTenant, label: string, mode: Mode, failure: Failure) {
    const first = `${label}-first`;
    return inTenant(
      prisma,
      tenant.tenantId,
      async (tx) => {
        const [row] = await readMarker(tx, first);
        if (row?.marker !== first || row.tenant !== tenant.tenantId) throw new Error(`mixed-up answer before the error: ${JSON.stringify(row)}`);
        if (mode === 'throw') await failure(tx, tenant);
        else if (mode === 'catch and keep querying') {
          await failure(tx, tenant).catch(() => undefined);
          await readMarker(tx, `${label}-after-abort`).catch(() => undefined);
        } else if (mode === 'failing query in parallel with another') {
          await Promise.all([failure(tx, tenant), readMarker(tx, `${label}-parallel`)]);
        } else {
          await tx.$executeRaw`SELECT pg_sleep(0.15)`;
        }
      },
      mode === 'timeout while a query runs' ? 50 : undefined,
    );
  }

  it.each(POOL_SIZES)('every tenant keeps reading its own answers (pool of %i connections)', async (poolSize) => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: inject('runtimeUrl'), max: poolSize }) });
    const problems: string[] = [];
    const errorCodes = new Set<string>();

    const worker = async (tenantIndex: number, workerIndex: number) => {
      const tenant = tenants[tenantIndex]!;
      for (let round = 0; round < ROUNDS_PER_WORKER; round += 1) {
        const label = `t${tenantIndex}-w${workerIndex}-r${round}`;
        const mode = MODES[round % MODES.length]!;
        const failure = FAILURES[FAILURE_NAMES[(round + workerIndex) % FAILURE_NAMES.length]!]!;

        await failingTransaction(prisma, tenant, label, mode, failure).catch((error: unknown) => {
          const mapped = mapDatabaseError(error);
          errorCodes.add(mapped?.code ?? String((error as { code?: string }).code));
          if (error instanceof Error && error.message.startsWith('mixed-up answer')) problems.push(error.message);
        });

        const expectedMarker = `${label}-second`;
        const read = await inTenant(prisma, tenant.tenantId, async (tx) => ({
          marker: await readMarker(tx, expectedMarker),
          companies: await tx.company.findMany({ select: { tenantId: true } }),
        }));
        const [row] = read.marker;
        const ownRowsOnly = read.companies.length === 1 && read.companies.every((company) => company.tenantId === tenant.tenantId);
        if (row?.marker !== expectedMarker || row.tenant !== tenant.tenantId || !ownRowsOnly) {
          problems.push(`${label}: ${JSON.stringify(read)}`);
        }

        const [bare] = await prisma.$queryRaw<{ tenant: string | null }[]>`SELECT current_setting('app.tenant_id', true) AS tenant`;
        if (bare?.tenant) problems.push(`${label}: the tenant stayed on the connection (${bare.tenant})`);
      }
    };

    try {
      await Promise.all(
        tenants.flatMap((_, tenantIndex) => Array.from({ length: WORKERS_PER_TENANT }, (__, workerIndex) => worker(tenantIndex, workerIndex))),
      );
    } finally {
      await prisma.$disconnect();
    }

    expect(problems).toEqual([]);
    // The scenario really produced database errors of the kinds that matter.
    expect(errorCodes).toContain('DUPLICATE');
    expect(errorCodes).toContain('INVALID_STATE');
    expect(errorCodes).toContain('INVALID_REFERENCE');
    expect(errorCodes).toContain('PERMISSION_DENIED');
  }, 120_000);
});
