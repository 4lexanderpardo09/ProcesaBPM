import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// Static site: plain HTML and the few scripts each section needs. `site` is the canonical address (LANDING_SITE_URL in
// the image build); it feeds the canonical links, the sitemap and the structured data.
export default defineConfig({
  site: process.env.LANDING_SITE_URL || 'https://procesabpm.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404') })],
  vite: {
    resolve: { alias: { '@design': fileURLToPath(new URL('../../docs/diseno', import.meta.url)) } },
  },
});
