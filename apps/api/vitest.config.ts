import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-supertest.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
