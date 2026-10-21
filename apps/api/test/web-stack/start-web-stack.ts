/**
 * The real API over a fresh PostgreSQL 18, for the web's stack E2E suite (apps/web/e2e-stack). It prepares its own
 * database (Testcontainers, or TEST_DATABASE_URL like the other suites), seeds fixed organizations and people, and
 * starts the production entry point under `/api`. Playwright starts it and stops it with SIGTERM.
 *
 * Storage is off by default (uploads fail). `WEB_STACK_STORAGE=1` starts a real S3 server like the integration suites
 * (SeaweedFS with Docker, or TEST_S3_ENDPOINT) and lets the web origins upload to it (`WEB_STACK_WEB_ORIGINS`, comma
 * separated; the Playwright web server by default), since the browser sends files straight to storage.
 */
import { randomBytes } from 'node:crypto';
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { setupTestDatabase, teardown } from '@procesabpm/db/testing';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { setupTestStorage, teardownTestStorage, type TestStorageSettings } from '../support/storage-setup.js';
import { seedWebStack } from './web-stack-fixtures.js';

const DATABASE_NAME = 'procesabpm_web_e2e';
const port = process.env.WEB_STACK_API_PORT ?? '3100';
const WEB_BASE_URL = 'http://localhost:4174';

async function provisionDatabase(): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  // setupTestDatabase hands its URLs to a Vitest project; this collects them instead.
  const project = { provide: (key: string, value: string) => (urls[key] = value) } as unknown as TestProject;
  await setupTestDatabase(project, DATABASE_NAME);
  return urls;
}

async function provisionStorage(): Promise<Record<string, string>> {
  let settings: TestStorageSettings | undefined;
  const project = { provide: (_key: string, value: TestStorageSettings) => (settings = value) } as unknown as TestProject;
  await setupTestStorage(project);
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = settings!;
  const origins = [WEB_BASE_URL, ...(process.env.WEB_STACK_WEB_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter((origin) => origin !== '')];
  const client = new S3Client({ region, endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ['PUT', 'GET'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'] }] } }));
  return { STORAGE_ENDPOINT: endpoint, STORAGE_REGION: region, STORAGE_BUCKET: bucket, STORAGE_ACCESS_KEY_ID: accessKeyId, STORAGE_SECRET_ACCESS_KEY: secretAccessKey, STORAGE_FORCE_PATH_STYLE: 'true' };
}

const NO_STORAGE = { STORAGE_ENDPOINT: 'http://127.0.0.1:9', STORAGE_BUCKET: 'web-e2e', STORAGE_ACCESS_KEY_ID: 'web-e2e', STORAGE_SECRET_ACCESS_KEY: 'web-e2e-secret' };

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
    ...(process.env.WEB_STACK_STORAGE === '1' ? await provisionStorage() : NO_STORAGE),
    WEB_BASE_URL,
  });
  await import('../../src/main.js');
}

const stop = () => {
  void Promise.allSettled([teardown(), teardownTestStorage()]).finally(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  await Promise.allSettled([teardown(), teardownTestStorage()]);
  process.exit(1);
});
