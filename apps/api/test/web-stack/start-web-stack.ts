/**
 * The real API over a fresh PostgreSQL 18, for the web's stack E2E suite (apps/web/e2e-stack). It prepares its own
 * database (Testcontainers, or TEST_DATABASE_URL like the other suites), seeds fixed organizations and people, and
 * starts the production entry point under `/api`. Playwright starts it and stops it with SIGTERM.
 */
import { randomBytes } from 'node:crypto';
import { setupTestDatabase, teardown } from '@procesabpm/db/testing';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { seedWebStack } from './web-stack-fixtures.js';

const DATABASE_NAME = 'procesabpm_web_e2e';
const port = process.env.WEB_STACK_API_PORT ?? '3100';

async function provisionDatabase(): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  // setupTestDatabase hands its URLs to a Vitest project; this collects them instead.
  const project = { provide: (key: string, value: string) => (urls[key] = value) } as unknown as TestProject;
  await setupTestDatabase(project, DATABASE_NAME);
  return urls;
}

async function main(): Promise<void> {
  const urls = await provisionDatabase();
  const platform = new pg.Pool({ connectionString: urls.platformUrl });
  try {
    await seedWebStack(platform);
  } finally {
    await platform.end();
  }

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: port,
    LOG_LEVEL: 'warn',
    DATABASE_URL: urls.runtimeUrl,
    PLATFORM_DATABASE_URL: urls.platformUrl,
    JWT_SECRET: randomBytes(48).toString('base64'),
    MFA_ENCRYPTION_KEYS: `e2e:${randomBytes(32).toString('base64')}`,
    TRUST_PROXY: 'false',
    REALTIME_ENABLED: 'false',
    STORAGE_ENDPOINT: 'http://127.0.0.1:9',
    STORAGE_BUCKET: 'web-e2e',
    STORAGE_ACCESS_KEY_ID: 'web-e2e',
    STORAGE_SECRET_ACCESS_KEY: 'web-e2e-secret',
    WEB_BASE_URL: 'http://localhost:4174',
  });
  await import('../../src/main.js');
}

const stop = () => {
  void teardown().finally(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  await teardown();
  process.exit(1);
});
