// Extract curated figures from a portfolio PDF, as listed in a project's crops.json.
//
//   node scripts/extract-pdf.mjs src/content/projects/<slug>/crops.json
//
// Each crop takes one of three routes, all chosen so no pixel is ever upscaled:
//   "embedded"  the raster exactly as stored in the PDF. Its pixels are remapped
//               (rotation/flip only, from the image's transform) into page
//               orientation, then optionally cropped (in oriented pixels).
//   "raster"    the page region rendered at the native density of the largest
//               raster under it (or `dpi`), so rasters are sampled ~1:1 and any
//               PDF text/vector overlays come along.
//   "vector"    a page region drawn with vectors, rendered at high DPI (default
//               450) so linework and annotations stay sharp when zoomed.
// Common options: `erase` (rects in PDF points, painted white, used only to remove
// sheet labels), `trim` (auto-trim white margins, default true), `pad` (px),
// `background` / `thicken` (transparent sheet, heavier lines; see lib/background.mjs).
// The resolved metadata (source px, dpi, output size) is written back into
// crops.json under `_resolved`, so every output can be reproduced and audited.
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { applyBackground } from './lib/background.mjs';

const cropsPath = process.argv[2];
if (!cropsPath) {
  console.error('Usage: node scripts/extract-pdf.mjs <path/to/crops.json>');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const projectDir = path.dirname(cropsPath);
const outDir = path.join(projectDir, spec.outDir ?? 'images');
fs.mkdirSync(outDir, { recursive: true });

const doc = mupdf.Document.openDocument(fs.readFileSync(spec.source), 'application/pdf');

/** All images on a page with their transforms, in paint order. */
function pageImages(page) {
  const images = [];
  page.runPageContents(
    new mupdf.Device({ fillImage: (image, ctm) => images.push({ image, ctm: [...ctm] }) }),
    mupdf.Matrix.identity,
  );
  return images;
}

/** Native density (pixels per PDF point) of an image as placed. */
function density({ image, ctm: [a, b, c, d] }) {
  return Math.max(image.getWidth() / Math.hypot(a, b), image.getHeight() / Math.hypot(c, d));
}

function placedRect([a, b, c, d, e, f]) {
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const overlaps = (r, s) => r[0] < s[2] && s[0] < r[2] && r[1] < s[3] && s[1] < r[3];

/**
 * Re-orient an embedded raster into page orientation by exact pixel remapping.
 * Only axis-aligned transforms (multiples of 90°, with or without a flip) are
 * accepted, so this is a pure permutation of the stored pixels.
 */
function orientEmbedded({ image, ctm: [a, b, c, d] }) {
  let pix = image.toPixmap();
  if (pix.getColorSpace()?.getNumberOfComponents() !== 3 || pix.getAlpha()) {
    pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
  }
  const W = pix.getWidth();
  const H = pix.getHeight();
  const n = pix.getStride() / W;
  const src = Buffer.from(pix.getPixels());
  const eps = 1e-6;
  if (!((Math.abs(b) < eps && Math.abs(c) < eps) || (Math.abs(a) < eps && Math.abs(d) < eps))) {
    throw new Error(`Image transform is not axis-aligned: ${[a, b, c, d]}`);
  }
  // Direction (on the page, y down) of increasing source column (u) and row (v).
  const uDir = [Math.sign(a), Math.sign(b)];
  const vDir = [Math.sign(c), Math.sign(d)];
  const swap = uDir[0] === 0; // source columns run vertically on the page
  const outW = swap ? H : W;
  const outH = swap ? W : H;
  const out = Buffer.alloc(outW * outH * n);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let u, v;
      if (!swap) {
        u = uDir[0] > 0 ? x : W - 1 - x;
        v = vDir[1] > 0 ? y : H - 1 - y;
      } else {
        u = uDir[1] > 0 ? y : W - 1 - y;
        v = vDir[0] > 0 ? x : H - 1 - x;
      }
      const from = (v * W + u) * n;
      src.copy(out, (y * outW + x) * n, from, from + n);
    }
  }
  return { buffer: out, width: outW, height: outH, channels: n, nativePx: [W, H] };
}

function renderRegion(page, rect, dpi) {
  const s = dpi / 72;
  const m = mupdf.Matrix.concat(mupdf.Matrix.translate(-rect[0], -rect[1]), mupdf.Matrix.scale(s, s));
  const w = Math.round((rect[2] - rect[0]) * s);
  const h = Math.round((rect[3] - rect[1]) * s);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(m, pix);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return { buffer: Buffer.from(pix.getPixels()), width: w, height: h, channels: 3 };
}

/** White-out rects given in PDF points on an image that maps `rect` at `scale` px/pt. */
async function erase(img, rects, rect, scale) {
  if (!rects?.length) return img;
  const composites = rects.map(([x0, y0, x1, y1]) => {
    const left = Math.max(0, Math.floor((x0 - rect[0]) * scale));
    const top = Math.max(0, Math.floor((y0 - rect[1]) * scale));
    const width = Math.min(img.info.width - left, Math.ceil((x1 - x0) * scale));
    const height = Math.min(img.info.height - top, Math.ceil((y1 - y0) * scale));
    return {
      input: { create: { width, height, channels: 3, background: '#ffffff' } },
      left,
      top,
    };
  });
  const { data, info } = await sharp(img.data, { raw: img.info })
    .composite(composites)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** Is every pixel neutral grey? Then store as greyscale PNG (lossless, smaller). */
function isNeutral(data, channels) {
  for (let i = 0; i < data.length; i += channels) {
    if (Math.abs(data[i] - data[i + 1]) > 2 || Math.abs(data[i] - data[i + 2]) > 2) return false;
  }
  return true;
}

const resolved = {};
for (const crop of spec.crops) {
  const page = doc.loadPage(crop.page - 1);
  const file = path.join(outDir, crop.name);
  let img; // { data, info }
  let meta = { mode: crop.mode, page: crop.page };

  if (crop.mode === 'embedded') {
    const imgs = pageImages(page);
    const src = imgs[crop.image - 1];
    const o = orientEmbedded(src);
    let s = sharp(o.buffer, { raw: { width: o.width, height: o.height, channels: o.channels } });
    if (crop.px) {
      const [x0, y0, x1, y1] = crop.px;
      s = s.extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 });
    }
    const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
    img = { data, info };
    meta = { ...meta, image: crop.image, nativePx: o.nativePx, densityDpi: +(density(src) * 72).toFixed(1) };
  } else if (crop.mode === 'raster') {
    const imgs = pageImages(page).filter((im) => overlaps(placedRect(im.ctm), crop.rect));
    const dpi =
      crop.dpi ?? Math.round(Math.max(...imgs.map((im) => density(im) * 72)));
    const r = renderRegion(page, crop.rect, dpi);
    img = { data: r.buffer, info: { width: r.width, height: r.height, channels: 3 } };
    img = await erase(img, crop.erase, crop.rect, dpi / 72);
    meta = { ...meta, rect: crop.rect, dpi };
  } else if (crop.mode === 'vector') {
    const dpi = crop.dpi ?? 450;
    const r = renderRegion(page, crop.rect, dpi);
    img = { data: r.buffer, info: { width: r.width, height: r.height, channels: 3 } };
    img = await erase(img, crop.erase, crop.rect, dpi / 72);
    meta = { ...meta, rect: crop.rect, dpi };
  } else {
    throw new Error(`Unknown mode "${crop.mode}" for ${crop.name}`);
  }

  let s = sharp(img.data, { raw: img.info });
  if (crop.trim !== false) s = sharp(await s.trim({ background: '#ffffff', threshold: 12 }).png().toBuffer());
  const pad = crop.pad ?? 0;
  if (pad) s = s.extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' });
  const flat = await s.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const gray = crop.color !== true && isNeutral(flat.data, flat.info.channels);
  const final = applyBackground(flat, crop);
  let out = sharp(final.data, { raw: final.info });
  if (gray) out = out.toColourspace('b-w');
  await out.png({ compressionLevel: 9 }).toFile(file);
  const { width, height } = await sharp(file).metadata();
  const bytes = fs.statSync(file).size;
  resolved[crop.name] = { ...meta, output: [width, height], gray, bytes };
  console.log(`${crop.name.padEnd(34)} ${String(width).padStart(5)}x${String(height).padEnd(5)} ${gray ? 'grey' : 'rgb '} ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${JSON.stringify(meta)}`);
}

spec._resolved = resolved;
fs.writeFileSync(cropsPath, JSON.stringify(spec, null, 2) + '\n');
