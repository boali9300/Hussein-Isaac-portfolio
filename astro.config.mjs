// @ts-check
import { defineConfig, sharpImageService } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// GitHub Pages project site: https://boali9300.github.io/Hussein-Isaac-portfolio/
// With a custom domain later: set `site` to the domain and remove `base`.
export default defineConfig({
  site: 'https://boali9300.github.io',
  base: '/Hussein-Isaac-portfolio',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [mdx(), sitemap()],
  devToolbar: { enabled: false },
  image: {
    // Never enlarge beyond an image's native size; let it scale down responsively.
    layout: 'constrained',
    service: sharpImageService({
      // Drawings are served lossless (WebP, PNG fallback): identical pixels, smaller files.
      // Renders use AVIF with a JPEG fallback (PNG when transparent), so lossless WebP
      // never applies to them — see src/lib/images.ts.
      webp: { lossless: true, effort: 4 },
      png: { compressionLevel: 9, adaptiveFiltering: true },
      jpeg: { mozjpeg: true },
    }),
  },
});
