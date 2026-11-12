#!/usr/bin/env node
// Screenshots of the bare viewer (tools/real/viewer.html). The dev server is started if it is not up.
//
//   node tools/real/shot.mjs --out .shots/real/x.png --view trailhead
//   node tools/real/shot.mjs --out x.png --cam 40,22,222,8,6,176 --fov 46 --show light --half
import { GL, args, devServer, loadPlaywright, settings } from './lib.mjs';

const opt = args(process.argv.slice(2));
const port = Number(opt.port ?? process.env.REAL_PORT ?? settings().port);
const [width, height] = String(opt.size ?? '1280x720').split('x').map(Number);
const q = new URLSearchParams();
for (const k of ['view', 'cam', 'fov', 'chunks', 'show', 'exposure', 'reflect', 'lut']) if (opt[k] !== undefined) q.set(k, String(opt[k]));
if (opt.half) q.set('half', '1');
const server = await devServer(port);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: GL });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });
  await page.goto(`http://localhost:${port}/tools/real/viewer.html?${q}`);
  await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 240000 });
  await page.waitForTimeout(Number(opt.wait ?? 800));
  const info = await page.evaluate(() => {
    const v = window.__viewer;
    return v;
  });
  await page.screenshot({ path: String(opt.out ?? '.shots/real/rp-viewer.png'), timeout: 180000 });
  console.log(JSON.stringify(info));
} finally {
  await browser.close();
  await server.stop();
}
