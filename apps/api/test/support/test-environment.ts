import { inject } from 'vitest';
import { afterAll, beforeAll } from 'vitest';

export const TEST_JWT_SECRET = 'integration-test-secret-with-more-than-32-bytes';
const VARIABLES = ['NODE_ENV', 'PORT', 'LOG_LEVEL', 'DATABASE_URL', 'PLATFORM_DATABASE_URL', 'JWT_SECRET'] as const;

/** Points the application configuration at the test database for the duration of a test file. */
export function useTestEnvironment(overrides: Partial<Record<(typeof VARIABLES)[number], string>> = {}): void {
  const original = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));

  beforeAll(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
      DATABASE_URL: inject('runtimeUrl'),
      PLATFORM_DATABASE_URL: inject('platformUrl'),
      JWT_SECRET: TEST_JWT_SECRET,
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
