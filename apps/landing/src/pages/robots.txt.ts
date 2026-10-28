import type { APIRoute } from 'astro';

/** Search engines and AI assistants may read every page; the API is not content. The sitemap lists the pages. */
const AI_AND_SEARCH_BOTS = ['Googlebot', 'Bingbot', 'Google-Extended', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Applebot', 'Applebot-Extended'];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://procesabpm.com');
  const groups = [...AI_AND_SEARCH_BOTS, '*'].map((bot) => `User-agent: ${bot}\nAllow: /\nDisallow: /api/`);
  const body = `${groups.join('\n\n')}\n\nSitemap: ${new URL('/sitemap-index.xml', base).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
