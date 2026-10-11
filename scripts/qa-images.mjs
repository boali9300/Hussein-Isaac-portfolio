// Verify extracted figures against the original PDF and build a contact sheet.
//
//   node scripts/qa-images.mjs src/content/projects/<slug>/crops.json
//
// For every crop it independently re-renders the source with MuPDF — the page
// region for raster/vector crops, or the embedded image drawn on its own with
// its PDF transform for embedded crops — at twice the figure's density (vector
// crops: same density), applies the same erase/trim/pad, and checks:
//   - dimensions match within 2px (no stretching, squashing or lost edges)
//   - compared as 256px thumbnails, the mean difference is ≤ 10/255 (catches
//     wrong orientation, a misplaced crop or heavy blur; tolerant of the 1px
//     shifts thin linework shows between render scales)
//   - the output is not larger than the source pixels (no upscaling)
// Writes _source/<pdf>/qa/index.html with each pair side by side.
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { thicken } from './lib/background.mjs';

const cropsPath = process.argv[2];
if (!cropsPath) {
  console.error('Usage: node scripts/qa-images.mjs <path/to/crops.json>');
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const imagesDir = path.join(path.dirname(cropsPath), spec.outDir ?? 'images');
const pdfName = path.basename(spec.source, path.extname(spec.source));
const qaDir = path.join('_source', pdfName, 'qa');
fs.mkdirSync(qaDir, { recursive: true });

const doc = mupdf.Document.openDocument(fs.readFileSync(spec.source), 'application/pdf');

function pageImages(page) {
  const images = [];
  page.runPageContents(
    new mupdf.Device({ fillImage: (image, ctm) => images.push({ image, ctm: [...ctm] }) }),
    mupdf.Matrix.identity,
  );
  return images;
}

function placedRect([a, b, c, d, e, f]) {
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function render(page, rect, dpi, only) {
  const s = dpi / 72;
  const m = mupdf.Matrix.concat(mupdf.Matrix.translate(-rect[0], -rect[1]), mupdf.Matrix.scale(s, s));
  const w = Math.round((rect[2] - rect[0]) * s);
  const h = Math.round((rect[3] - rect[1]) * s);
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(m, pix);
  if (only) dev.fillImage(only.image, only.ctm, 1);
  else page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return { data: Buffer.from(pix.getPixels()), info: { width: w, height: h, channels: 3 } };
}

/**
 * Embedded crops are meant to be exact copies of the stored pixels. Check that
 * independently of extract-pdf.mjs: try all 8 rotations/flips of the raw image
 * (via sharp), pick the one that best matches MuPDF's own rendering of the
 * image on the page, apply the same crop/trim/pad, and require the extracted
 * file to be pixel-identical to it.
 */
async function verifyEmbedded(page, src, crop, outFile) {
  let pix = src.image.toPixmap();
  if (pix.getColorSpace()?.getNumberOfComponents() !== 3 || pix.getAlpha()) {
    pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, false);
  }
  const raw = { width: pix.getWidth(), height: pix.getHeight(), channels: pix.getStride() / pix.getWidth() };
  const pixels = Buffer.from(pix.getPixels());
  const candidates = {
    none: (s) => s,
    flop: (s) => s.flop(),
    flip: (s) => s.flip(),
    rotate180: (s) => s.rotate(180),
    rotate90: (s) => s.rotate(90),
    rotate270: (s) => s.rotate(270),
    'rotate90+flop': (s) => s.rotate(90).flop(),
    'rotate270+flop': (s) => s.rotate(270).flop(),
  };

  const pr = placedRect(src.ctm);
  const shown = render(page, pr, 72, src); // MuPDF's own placement, 1px per pt
  const thumb = async (s) => s.resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
  const target = await thumb(sharp(shown.data, { raw: shown.info }));
  let best;
  for (const [name, fn] of Object.entries(candidates)) {
    const oriented = await fn(sharp(pixels, { raw })).raw().toBuffer({ resolveWithObject: true });
    const t = await thumb(sharp(oriented.data, { raw: oriented.info }));
    let d = 0;
    for (let i = 0; i < t.length; i++) d += Math.abs(t[i] - target[i]);
    d /= t.length;
    if (!best || d < best.d) best = { name, d, oriented };
  }

  let s = sharp(best.oriented.data, { raw: best.oriented.info });
  if (crop.px) {
    const [x0, y0, x1, y1] = crop.px;
    s = sharp(await s.extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer());
  }
  if (crop.trim !== false) s = sharp(await s.trim({ background: '#ffffff', threshold: 12 }).png().toBuffer());
  if (crop.pad) s = s.extend({ top: crop.pad, bottom: crop.pad, left: crop.pad, right: crop.pad, background: '#ffffff' });
  const expected = await s.removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const actual = await sharp(outFile).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let maxDiff = 255;
  if (expected.info.width === actual.info.width && expected.info.height === actual.info.height) {
    maxDiff = 0;
    for (let i = 0; i < expected.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected.data[i] - actual.data[i]));
  }
  return { orientation: best.name, orientationDiff: best.d, orientationAgrees: best.d <= 25, maxDiff };
}

const rows = [];
let failures = 0;

for (const crop of spec.crops) {
  const page = doc.loadPage(crop.page - 1);
  const resolved = spec._resolved?.[crop.name] ?? {};
  let rect;
  let density; // output px per pt
  let sourcePx; // native pixels available for this region (raster sources)
  let only; // embedded crops: draw just this image, without page overlays or clips

  if (crop.mode === 'embedded') {
    const src = pageImages(page)[crop.image - 1];
    only = src;
    const pr = placedRect(src.ctm);
    const [W, H] = resolved.nativePx;
    const swap = Math.abs(src.ctm[0]) < 1e-6;
    const ow = swap ? H : W;
    const oh = swap ? W : H;
    const [x0, y0, x1, y1] = crop.px ?? [0, 0, ow, oh];
    const sx = (pr[2] - pr[0]) / ow;
    const sy = (pr[3] - pr[1]) / oh;
    rect = [pr[0] + x0 * sx, pr[1] + y0 * sy, pr[0] + x1 * sx, pr[1] + y1 * sy];
    density = 1 / sx;
    sourcePx = [x1 - x0, y1 - y0];
  } else {
    rect = crop.rect;
    density = (resolved.dpi ?? crop.dpi ?? 450) / 72;
    sourcePx = crop.mode === 'raster' ? [Math.round((rect[2] - rect[0]) * density), Math.round((rect[3] - rect[1]) * density)] : null;
  }

  const refScale = crop.mode === 'vector' ? 1 : 2;
  const refDpi = density * 72 * refScale;
  let ref = render(page, rect, refDpi, only);
  if (crop.erase?.length) {
    const s = refDpi / 72;
    ref = {
      data: await sharp(ref.data, { raw: ref.info })
        .composite(
          crop.erase.map(([x0, y0, x1, y1]) => ({
            input: { create: { width: Math.ceil((x1 - x0) * s), height: Math.ceil((y1 - y0) * s), channels: 3, background: '#fff' } },
            left: Math.max(0, Math.floor((x0 - rect[0]) * s)),
            top: Math.max(0, Math.floor((y0 - rect[1]) * s)),
          })),
        )
        .removeAlpha()
        .raw()
        .toBuffer(),
      info: ref.info,
    };
  }
  let refImg = sharp(ref.data, { raw: ref.info });
  if (crop.trim !== false) refImg = sharp(await refImg.trim({ background: '#ffffff', threshold: 12 }).png().toBuffer());
  const pad = (crop.pad ?? 0) * refScale;
  if (pad) refImg = refImg.extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' });
  if (crop.thicken) {
    // Compare against the reference with the same deliberate line weight.
    const raw = await refImg.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const heavy = thicken(raw.data, raw.info.width, raw.info.height, crop.thicken * refScale);
    refImg = sharp(heavy, { raw: { width: raw.info.width, height: raw.info.height, channels: 3 } });
  }
  const refPng = await refImg.png().toBuffer();
  const refMeta = await sharp(refPng).metadata();

  const outFile = path.join(imagesDir, crop.name);
  const outMeta = await sharp(outFile).metadata();
  const expW = refMeta.width / refScale;
  const expH = refMeta.height / refScale;
  const dimErr = Math.max(Math.abs(expW - outMeta.width), Math.abs(expH - outMeta.height));
  const aspectErr = Math.abs(expW / expH - outMeta.width / outMeta.height) / (outMeta.width / outMeta.height);

  const tw = 256;
  const th = Math.max(1, Math.round((tw * outMeta.height) / outMeta.width));
  const grey = (buf) => sharp(buf).resize(tw, th, { fit: 'fill' }).greyscale().raw().toBuffer();
  // Transparent sheets (crop.background) are compared as printed on white.
  const a = await grey(await sharp(outFile).flatten({ background: '#ffffff' }).png().toBuffer());
  const b = await grey(refPng);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  const mad = sum / a.length;

  const upscaled = sourcePx ? outMeta.width - 2 * (crop.pad ?? 0) > sourcePx[0] + 1 : false;
  let exact; // embedded crops only: { orientation, maxDiff }
  if (only) exact = await verifyEmbedded(page, only, crop, outFile);
  const pass = exact
    ? exact.maxDiff <= 1 && exact.orientationAgrees && !upscaled
    : dimErr <= 2 && mad <= 10 && !upscaled;
  if (!pass) failures++;

  const refName = crop.name.replace(/\.png$/, '.ref.png');
  fs.writeFileSync(path.join(qaDir, refName), refPng);
  fs.copyFileSync(outFile, path.join(qaDir, crop.name));
  rows.push({ crop, outMeta, refMeta, dimErr, aspectErr, mad, exact, upscaled, pass, refName, sourcePx, densityDpi: density * 72 });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${crop.name.padEnd(34)} out ${outMeta.width}x${outMeta.height}  size Δ ${dimErr.toFixed(1)}px  aspect Δ ${(aspectErr * 100).toFixed(2)}%  diff ${mad.toFixed(2)}${exact ? `  exact copy: max Δ ${exact.maxDiff} (${exact.orientation})` : ''}${upscaled ? '  UPSCALED' : ''}`,
  );
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html><meta charset="utf-8"><title>Image QA — ${esc(pdfName)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;background:#f4f1ea;color:#151515}
h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #ccc;padding:12px;vertical-align:top;text-align:left}
img{max-width:520px;max-height:420px;background:#fff;box-shadow:0 0 0 1px #ccc}.fail{color:#b00020;font-weight:600}.pass{color:#1b6e3a;font-weight:600}
code{font-size:12px}
</style>
<h1>Image QA — ${esc(spec.source)}</h1>
<p>Left: an independent MuPDF render of the source (page region, or the embedded image alone) at 2× the figure's density (vector crops: equal density). Right: the extracted figure used on the site.
Pass — embedded crops: pixel-identical to the stored image under the orientation MuPDF itself renders; rendered crops: size within 2px and mean difference ≤ 10/255 on 256px thumbnails; never upscaled. ${rows.length - failures}/${rows.length} pass.</p>
<table><tr><th>Figure</th><th>Original PDF region</th><th>Extracted</th></tr>
${rows
  .map(
    (r) => `<tr><td><b>${esc(r.crop.name)}</b><br>page ${r.crop.page} · ${r.crop.mode}<br>
output ${r.outMeta.width}×${r.outMeta.height}px<br>${r.sourcePx ? `source ${r.sourcePx.join('×')}px · ` : ''}${Math.round(r.densityDpi)} dpi on the sheet<br>
${r.exact ? `exact copy of stored pixels: max Δ ${r.exact.maxDiff} · orientation ${r.exact.orientation} (match ${r.exact.orientationDiff.toFixed(1)})` : `size Δ ${r.dimErr.toFixed(1)}px · aspect Δ ${(r.aspectErr * 100).toFixed(2)}% · diff ${r.mad.toFixed(2)}`}<br>
<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}${r.upscaled ? ' — upscaled' : ''}</span></td>
<td><img src="${esc(r.refName)}" alt=""></td><td><img src="${esc(r.crop.name)}" alt=""></td></tr>`,
  )
  .join('\n')}
</table>`;
fs.writeFileSync(path.join(qaDir, 'index.html'), html);
console.log(`\n${rows.length - failures}/${rows.length} pass — contact sheet: ${path.join(qaDir, 'index.html')}`);
if (failures) process.exit(1);
