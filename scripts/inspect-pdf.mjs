// Inventory a portfolio PDF before curation.
//
//   node scripts/inspect-pdf.mjs _source/Salk.pdf [--dpi 150]
//
// Writes to _source/<pdf-name>/:
//   pages/p01.png ...       page previews (for reviewing and picking crop boxes)
//   embedded/p01-i1.png ... every embedded raster at its native pixel size
//   inventory.json          per page: size, vector/text/image counts, image
//                           placements (PDF points) and the page text
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';

const args = process.argv.slice(2);
const pdfPath = args.find((a) => !a.startsWith('--'));
if (!pdfPath) {
  console.error('Usage: node scripts/inspect-pdf.mjs <file.pdf> [--dpi 150]');
  process.exit(1);
}
const dpiFlag = args.indexOf('--dpi');
const previewDpi = dpiFlag > -1 ? Number(args[dpiFlag + 1]) : 150;

const name = path.basename(pdfPath, path.extname(pdfPath));
const outDir = path.join('_source', name);
fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'embedded'), { recursive: true });

const doc = mupdf.Document.openDocument(fs.readFileSync(pdfPath), 'application/pdf');
const pad = (n) => String(n).padStart(2, '0');

// Axis-aligned bounds of the unit square mapped through an image's CTM.
function placedRect([a, b, c, d, e, f]) {
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(1));
}

const inventory = [];
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  const [x0, y0, x1, y1] = page.getBounds();
  const stats = { fills: 0, strokes: 0, text: 0, shades: 0, images: [] };

  page.runPageContents(
    new mupdf.Device({
      fillPath: () => stats.fills++,
      strokePath: () => stats.strokes++,
      fillText: () => stats.text++,
      fillShade: () => stats.shades++,
      fillImage: (image, ctm) => {
        const k = stats.images.length + 1;
        const file = `p${pad(i + 1)}-i${k}.png`;
        fs.writeFileSync(path.join(outDir, 'embedded', file), image.toPixmap().asPNG());
        const rect = placedRect(ctm);
        const placedW = (rect[2] - rect[0]) / 72; // inches on the sheet
        stats.images.push({
          file,
          px: [image.getWidth(), image.getHeight()],
          placedPt: rect,
          effectiveDpi: Math.round(image.getWidth() / placedW),
        });
      },
    }),
    mupdf.Matrix.identity,
  );

  const scale = previewDpi / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(path.join(outDir, 'pages', `p${pad(i + 1)}.png`), pix.asPNG());

  const text = page.toStructuredText('preserve-whitespace').asText().replace(/\s+\n/g, '\n').trim();
  inventory.push({ page: i + 1, sizePt: [x1 - x0, y1 - y0], ...stats, text });
  console.log(
    `p${pad(i + 1)}  ${Math.round(x1 - x0)}x${Math.round(y1 - y0)}pt  paths ${stats.fills}f/${stats.strokes}s  text ${stats.text}  images ${stats.images
      .map((im) => `${im.px.join('x')}@${im.effectiveDpi}dpi`)
      .join(', ')}`,
  );
}

fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(inventory, null, 2));
console.log(`\n${inventory.length} pages -> ${outDir}`);
