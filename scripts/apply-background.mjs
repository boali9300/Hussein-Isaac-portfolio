// Apply the `background` / `thicken` options in a project's crops.json to images
// already extracted, without re-reading the source PDF.
//
//   node scripts/apply-background.mjs src/content/projects/<slug>/crops.json
//
// extract-pdf.mjs applies the same options itself; this is for images extracted
// before the options were set. An image that already has an alpha channel has
// been processed and is skipped, so the script is safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { applyBackground } from './lib/background.mjs';

const cropsPath = process.argv[2];
if (!cropsPath) {
  console.error('Usage: node scripts/apply-background.mjs <path/to/crops.json>');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const outDir = path.join(path.dirname(cropsPath), spec.outDir ?? 'images');

for (const crop of spec.crops) {
  if (!crop.background) continue;
  const file = path.join(outDir, crop.name);
  const meta = await sharp(file).metadata();
  if (meta.hasAlpha) {
    console.log(`${crop.name.padEnd(34)} skipped (already transparent)`);
    continue;
  }
  const gray = meta.channels === 1;
  const flat = await sharp(file).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const final = applyBackground(flat, crop);
  let out = sharp(final.data, { raw: final.info });
  if (gray) out = out.toColourspace('b-w');
  await out.png({ compressionLevel: 9 }).toFile(file + '.tmp');
  fs.renameSync(file + '.tmp', file);
  const bytes = fs.statSync(file).size;
  if (spec._resolved?.[crop.name]) spec._resolved[crop.name].bytes = bytes;
  console.log(`${crop.name.padEnd(34)} ${crop.background}${crop.thicken ? ` +${crop.thicken}px` : ''}  ${(bytes / 1024).toFixed(0)} KB`);
}

fs.writeFileSync(cropsPath, JSON.stringify(spec, null, 2) + '\n');
