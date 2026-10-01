import pg from 'pg';
import { inject } from 'vitest';

export interface RequestContext {
  tenantId?: string;
  userId?: string;
}

export interface TestDatabase {
  /** Connects as a member of `app_runtime`: RLS applies, like the API. */
  runtime: pg.Pool;
  /** Connects as a member of `app_platform`: bypasses RLS, like provisioning jobs. */
  platform: pg.Pool;
  /** Connects as a member of `app_worker`: RLS applies; it is the only role that claims outbox events. */
  worker: pg.Pool;
  /** Connects as the schema owner (superuser in tests). */
  owner: pg.Pool;
  close(): Promise<void>;
}

export function connectTestDatabase(): TestDatabase {
  const runtime = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 4 });
  const platform = new pg.Pool({ connectionString: inject('platformUrl'), max: 4 });
  const worker = new pg.Pool({ connectionString: inject('workerUrl'), max: 4 });
  const owner = new pg.Pool({ connectionString: inject('ownerUrl'), max: 2 });

  return {
    runtime,
    platform,
    worker,
    owner,
    async close() {
      await Promise.all([runtime.end(), platform.end(), worker.end(), owner.end()]);
    },
  };
}

/**
 * Runs `work` inside a transaction with the request context set the same way the
 * API does it: transaction-local settings, so a pooled connection never leaks them.
 */
export async function withContext<T>(
  pool: pg.Pool,
  context: RequestContext,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [context.tenantId ?? '']);
    await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId ?? '']);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `work` in a plain transaction (no request context is set). */
export async function withoutContext<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `operation` and returns the Postgres error code (SQLSTATE) it failed with,
 * or undefined if it succeeded. Takes a function so the query only starts when awaited.
 */
export async function sqlStateOf(operation: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

export const SqlState = {
  restrictViolation: '23001',
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
  checkViolation: '23514',
  exclusionViolation: '23P01',
  insufficientPrivilege: '42501',
} as const;
