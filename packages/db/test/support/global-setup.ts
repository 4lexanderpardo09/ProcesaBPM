import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { seedGlobalCatalog } from '../../src/seed/seed-global-catalog.js';
import { applyMigrations } from './apply-migrations.js';

export const RUNTIME_LOGIN = { user: 'test_runtime', password: 'runtime' } as const;
export const PLATFORM_LOGIN = { user: 'test_platform', password: 'platform' } as const;

/** Database created (and recreated on every run) when an external server is used. */
const EXTERNAL_TEST_DATABASE = 'procesabpm_test';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    runtimeUrl: string;
    platformUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts PostgreSQL 18 in Docker (Testcontainers). When Docker is not available
 * (e.g. a cloud sandbox), set TEST_DATABASE_URL to a superuser connection of an
 * existing PostgreSQL 18 server: a fresh `procesabpm_test` database is created on it.
 */
export async function setup(project: TestProject): Promise<void> {
  const ownerUrl = await provisionDatabase();

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
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

async function provisionDatabase(): Promise<string> {
  const externalUrl = process.env.TEST_DATABASE_URL;
  if (!externalUrl) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    return container.getConnectionUri();
  }

  const admin = new pg.Client({ connectionString: externalUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${EXTERNAL_TEST_DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${EXTERNAL_TEST_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = new URL(externalUrl);
  url.pathname = `/${EXTERNAL_TEST_DATABASE}`;
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
