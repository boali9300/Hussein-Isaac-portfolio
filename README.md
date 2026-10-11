# Hussein Isaac — Architecture Portfolio

Source for Hussein Isaac's architecture portfolio, a static site built with
[Astro](https://astro.build) and published on GitHub Pages at
`https://boali9300.github.io/Hussein-Isaac-portfolio/`.

## Develop

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:4321/Hussein-Isaac-portfolio/
npm run build      # type check + production build into dist/
npm run preview    # serve dist/ locally
npm run check:links
```

### Review mode

Facts awaiting confirmation and draft projects are visible (highlighted) in
`npm run dev` and in review builds, and are removed from production builds:

```bash
PUBLIC_REVIEW=true npm run build
```

Confirmed details live in `src/data/site.ts` (`pending(...)` vs plain values) and in
each project's frontmatter (`facts` vs `pending`, `draft: true/false`).

## Adding a project

1. Put the source PDF in `_source/` (git-ignored, never deployed).
2. Inventory it: `node scripts/inspect-pdf.mjs _source/<file>.pdf` writes page previews,
   every embedded image at native size, and the page text to `_source/<file>/`.
3. Create `src/content/projects/<slug>/crops.json` listing the figures to extract
   (see the Salk project for the three modes: `embedded`, `raster`, `vector`), then run
   `npm run extract -- src/content/projects/<slug>/crops.json`.
4. Verify against the PDF: `npm run qa:images -- src/content/projects/<slug>/crops.json`
   builds a side-by-side contact sheet in `_source/<file>/qa/`.
5. Write `src/content/projects/<slug>/index.mdx` with the shared components
   (`Chapter`, `Figure`, `FigureGrid`, `Legend`, `DataTable`). Keep `draft: true` until approved.

Images are never upscaled. Drawings are served lossless (WebP with PNG fallback), and
renders as AVIF with a JPEG fallback.

## Structure

```
src/content/projects/<slug>/   index.mdx, images/, crops.json
src/components/                shared UI (one design system for every page)
src/styles/tokens.css          color, type, spacing, motion tokens
src/data/site.ts               identity, contact, navigation
scripts/                       PDF inventory/extraction, image QA, link check, screenshots
```

## License

The site's code is MIT-licensed (see `LICENSE`). The portfolio content (drawings,
renderings, photographs and text) is © Hussein Isaac, all rights reserved. Third-party
imagery is credited where it is shown.
