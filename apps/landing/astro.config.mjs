import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Static site: plain HTML and the few scripts each section needs. Until there is a domain, `site` is the test server's.
export default defineConfig({
  site: process.env.LANDING_SITE_URL || 'https://www.3-83-248-175.sslip.io',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  vite: {
    resolve: { alias: { '@design': fileURLToPath(new URL('../../docs/diseno', import.meta.url)) } },
  },
});
