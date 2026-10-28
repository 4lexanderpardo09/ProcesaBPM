import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/** The blog: one Markdown file per article in src/content/blog. A draft builds in `astro dev` only. */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(90),
    description: z.string().max(180),
    publishedAt: z.coerce.date(),
    author: z.string().default('Equipo ProcesaBPM'),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
