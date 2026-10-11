// Verify every internal link and asset in the built site resolves under the
// GitHub Pages base path. Run after `astro build`.
//
//   node scripts/check-links.mjs [dist]
//
// Checks href / src / srcset / og:image / canonical in every HTML page, plus
// every URL in the sitemap. Root-absolute paths that skip the base (e.g.
// "/work/") are errors: they would 404 on https://<user>.github.io/<repo>/.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const config = fs.readFileSync('astro.config.mjs', 'utf8');
const base = (config.match(/base:\s*'([^']*)'/)?.[1] ?? '').replace(/\/$/, '');
const site = config.match(/site:\s*'([^']*)'/)?.[1] ?? '';
const origin = new URL(site).origin;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });

const files = walk(dist);
const pages = files.filter((f) => f.endsWith('.html'));
const errors = [];
const external = new Set();
let checked = 0;

function resolveUrl(raw, fromFile) {
  if (!raw || raw.startsWith('#') || /^(mailto|tel|data|javascript):/.test(raw)) return null;
  let u = raw;
  if (u.startsWith(origin)) u = u.slice(origin.length);
  else if (/^https?:\/\//.test(u)) {
    external.add(u);
    return null;
  }
  u = u.split('#')[0].split('?')[0];
  if (!u) return null;
  if (u.startsWith('/')) {
    if (base && !(u === base || u.startsWith(`${base}/`))) return { error: `missing base path: ${raw}` };
    u = u.slice(base.length) || '/';
    return { file: path.join(dist, decodeURIComponent(u)) };
  }
  return { file: path.join(path.dirname(fromFile), decodeURIComponent(u)) };
}

function exists(file) {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return true;
  return fs.existsSync(path.join(file, 'index.html'));
}

function check(raw, fromFile, attr) {
  const r = resolveUrl(raw.trim(), fromFile);
  if (!r) return;
  checked++;
  const where = `${path.relative(dist, fromFile)} [${attr}]`;
  if (r.error) errors.push(`${where}: ${r.error}`);
  else if (!exists(r.file)) errors.push(`${where}: not found: ${raw}`);
}

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  for (const [, attr, val] of html.matchAll(/\s(href|src|data-zoom-src|content)="([^"]*)"/g)) {
    if (attr === 'content' && !/^(https?:\/\/|\/)/.test(val)) continue;
    check(val, page, attr);
  }
  for (const [, val] of html.matchAll(/\ssrcset="([^"]*)"/g)) {
    for (const part of val.split(',')) check(part.trim().split(/\s+/)[0], page, 'srcset');
  }
}

// Sitemap URLs must map to built pages.
for (const sm of files.filter((f) => /sitemap-\d+\.xml$/.test(f))) {
  const xml = fs.readFileSync(sm, 'utf8');
  for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) check(loc, sm, 'sitemap');
}

console.log(`Checked ${checked} internal references across ${pages.length} pages (base "${base || '/'}").`);
if (external.size) console.log(`External links (not fetched):\n  ${[...external].join('\n  ')}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('All internal links and assets resolve.');
