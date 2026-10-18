import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 4174;
const API_PORT = 3100;

/**
 * The web against the real API and PostgreSQL: what the fake API cannot prove (the httpOnly refresh cookie on
 * Path=/api/auth through the proxy, real rotation and the 10-second reuse rule). The API side seeds fixed people
 * and organizations (apps/api/test/web-stack); needs Docker or TEST_DATABASE_URL.
 */
export default defineConfig({
  testDir: 'e2e-stack',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-stack' }]] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @procesabpm/api e2e:web-stack',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { WEB_STACK_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
    {
      command: `pnpm build && pnpm preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
