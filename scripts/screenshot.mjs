// Full-page screenshots of the running site at several widths, for visual review.
// Uses the locally installed Microsoft Edge (or Chrome) over the DevTools
// protocol — no extra dependencies or browser downloads.
//
//   node scripts/screenshot.mjs <out-dir> <url> [<url> ...] [--widths 375,768,1280,1920]
//
// Reduced motion is emulated so scroll-reveal content is fully visible.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const wIdx = args.indexOf('--widths');
const widths = wIdx > -1 ? args.splice(wIdx, 2)[1].split(',').map(Number) : [375, 768, 1280, 1920];
const [outDir, ...urls] = args;
if (!outDir || !urls.length) {
  console.error('Usage: node scripts/screenshot.mjs <out-dir> <url> [...] [--widths 375,768,1280,1920]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const exe = candidates.find((p) => fs.existsSync(p));
if (!exe) throw new Error('No Edge/Chrome found; set BROWSER=/path/to/browser');

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
const browser = spawn(exe, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Browser did not start');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    waiters.filter((w) => w.method === msg.method).forEach((w) => w.resolve(msg.params));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));

await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

for (const url of urls) {
  const slug = new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
  for (const width of widths) {
    const mobile = width < 768;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await loaded;
    await send('Runtime.evaluate', {
      expression: `(async () => {
        document.querySelectorAll('[data-reveal]').forEach((e) => e.classList.add('is-visible'));
        const imgs = [...document.images];
        imgs.forEach((i) => (i.loading = 'eager'));
        await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
        await document.fonts.ready;
      })()`,
      awaitPromise: true,
    });
    await sleep(600);
    const { result } = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth})',
      returnByValue: true,
    });
    const { h, w } = JSON.parse(result.value);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: h, scale: 1 },
    });
    const file = path.join(outDir, `${slug}-${width}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`${file}  ${width}x${h}${w > width ? `  ⚠ horizontal overflow: ${w}px` : ''}`);
  }
}

ws.close();
browser.kill();
