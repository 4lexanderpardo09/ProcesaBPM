import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { seedGlobalCatalog } from '../../src/seed/seed-global-catalog.js';
import { applyMigrations } from './apply-migrations.js';

export const RUNTIME_LOGIN = { user: 'test_runtime', password: 'runtime' } as const;
export const PLATFORM_LOGIN = { user: 'test_platform', password: 'platform' } as const;
export const WORKER_LOGIN = { user: 'test_worker', password: 'worker' } as const;

/** Database created (and recreated on every run) when an external server is used. */
export const DEFAULT_TEST_DATABASE = 'procesabpm_test';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    runtimeUrl: string;
    platformUrl: string;
    workerUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts PostgreSQL 18 in Docker (Testcontainers). When Docker is not available
 * (e.g. a cloud sandbox), set TEST_DATABASE_URL to a superuser connection of an
 * existing PostgreSQL 18 server: a fresh `procesabpm_test` database is created on it.
 */
export async function setup(project: TestProject): Promise<void> {
  await setupTestDatabase(project, DEFAULT_TEST_DATABASE);
}

/**
 * Same as `setup`, with its own database name so that packages whose tests run at the same
 * time (`pnpm -r test`) never drop each other's database.
 */
export async function setupTestDatabase(project: TestProject, databaseName: string): Promise<void> {
  const ownerUrl = await provisionDatabase(databaseName);

  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    await applyMigrations(owner);
    await createLoginRoles(owner);
    await seedGlobalCatalog(owner, { holidayYears: [2026, 2027] });
  } finally {
    await owner.end();
  }

  project.provide('ownerUrl', ownerUrl);
  project.provide('runtimeUrl', withCredentials(ownerUrl, RUNTIME_LOGIN));
  project.provide('platformUrl', withCredentials(ownerUrl, PLATFORM_LOGIN));
  project.provide('workerUrl', withCredentials(ownerUrl, WORKER_LOGIN));
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

async function provisionDatabase(databaseName: string): Promise<string> {
  const externalUrl = process.env.TEST_DATABASE_URL;
  if (!externalUrl) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    return container.getConnectionUri();
  }

  const admin = new pg.Client({ connectionString: externalUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  const url = new URL(externalUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Login roles as the infrastructure creates them. Role attributes such as BYPASSRLS are
 * not inherited through membership, so each login session switches to its app role.
 * Roles are cluster-wide, so they are only created when missing.
 */
async function createLoginRoles(owner: pg.Client): Promise<void> {
  for (const [login, appRole] of [
    [RUNTIME_LOGIN, 'app_runtime'],
    [PLATFORM_LOGIN, 'app_platform'],
    [WORKER_LOGIN, 'app_worker'],
  ] as const) {
    const { rowCount } = await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [login.user]);
    if (!rowCount) {
      await owner.query(`CREATE ROLE ${login.user} LOGIN PASSWORD '${login.password}' IN ROLE ${appRole}`);
    }
    await owner.query(`ALTER ROLE ${login.user} SET role = '${appRole}'`);
  }
}

function withCredentials(url: string, login: { user: string; password: string }): string {
  const parsed = new URL(url);
  parsed.username = login.user;
  parsed.password = login.password;
  return parsed.toString();
}
