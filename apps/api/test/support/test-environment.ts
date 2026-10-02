import { inject } from 'vitest';
import { afterAll, beforeAll } from 'vitest';

export const TEST_WEB_BASE_URL = 'http://web.test';
export const TEST_OUTBOX_TOKEN_KEY = 'outbox-test-key-with-more-than-32-bytes!!';
export const TEST_JWT_SECRET = 'integration-test-secret-with-more-than-32-bytes';
const VARIABLES = [
  'NODE_ENV',
  'PORT',
  'LOG_LEVEL',
  'DATABASE_URL',
  'WORKER_DATABASE_URL',
  'PLATFORM_DATABASE_URL',
  'JWT_SECRET',
  'TRUST_PROXY',
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_FORCE_PATH_STYLE',
  'WEB_BASE_URL',
  'OUTBOX_TOKEN_KEY',
  'MAIL_TRANSPORT',
  'OUTBOX_POLLING_ENABLED',
  'OUTBOX_BATCH_SIZE',
  'OUTBOX_CONCURRENCY',
] as const;

/** Points the application configuration at the test database for the duration of a test file. */
export function useTestEnvironment(overrides: Partial<Record<(typeof VARIABLES)[number], string>> = {}): void {
  const original = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));

  beforeAll(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
      DATABASE_URL: inject('runtimeUrl'),
      WORKER_DATABASE_URL: inject('workerUrl'),
      PLATFORM_DATABASE_URL: inject('platformUrl'),
      JWT_SECRET: TEST_JWT_SECRET,
      STORAGE_ENDPOINT: inject('storage').endpoint,
      STORAGE_REGION: inject('storage').region,
      STORAGE_BUCKET: inject('storage').bucket,
      STORAGE_ACCESS_KEY_ID: inject('storage').accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: inject('storage').secretAccessKey,
      STORAGE_FORCE_PATH_STYLE: 'true',
      WEB_BASE_URL: TEST_WEB_BASE_URL,
      OUTBOX_TOKEN_KEY: TEST_OUTBOX_TOKEN_KEY,
      MAIL_TRANSPORT: 'memory',
      OUTBOX_POLLING_ENABLED: 'false',
      OUTBOX_BATCH_SIZE: '50',
      OUTBOX_CONCURRENCY: '16',
      ...overrides,
    });
  });

  afterAll(() => {
    for (const name of VARIABLES) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
}
