import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * A project is a folder in src/content/projects/<slug>/ holding index.mdx,
 * images/ and crops.json (how each image was extracted from the source PDF).
 *
 * Only facts confirmed by Hussein go in plain fields. Facts that still need his
 * confirmation go in `pending`: they show (highlighted) in dev/review builds and
 * are dropped from production builds. Unknown facts are simply left out.
 */
const projects = defineCollection({
  loader: glob({
    base: './src/content/projects',
    pattern: '*/index.mdx',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      type: z.string(),
      categories: z.array(z.string()).min(1),
      cover: image(),
      coverAlt: z.string(),
      coverCaption: z.string().optional(),
      /** Optional drawing used in the homepage hero when this project is featured. */
      heroImage: image().optional(),
      heroAlt: z.string().optional(),
      heroCaption: z.string().optional(),
      order: z.number().int(),
      featured: z.boolean().default(false),
      /** Hidden from production builds until Hussein approves the page. */
      draft: z.boolean().default(true),
      /** Title-block rows, in display order. */
      facts: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
      pending: z
        .array(z.object({ label: z.string(), value: z.string(), note: z.string().optional() }))
        .default([]),
    }),
});

export const collections = { projects };
