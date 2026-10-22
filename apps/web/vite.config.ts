import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Same origin for the web and the API: the refresh cookie (Path=/api/auth) only works that way. */
const apiProxy = { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false, ws: true } };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fromHere('./src'),
      '@design': fromHere('../../docs/diseno'),
    },
  },
  server: { port: 5173, proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Whole pages render in jsdom with many user events: with every core busy, a long one passes the 5 s default.
    testTimeout: 15_000,
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
