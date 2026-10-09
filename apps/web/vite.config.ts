import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fromHere('./src'),
      '@design': fromHere('../../docs/diseno'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.ts'],
    setupFiles: ['src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
