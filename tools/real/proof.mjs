#!/usr/bin/env node
// Pictures that put the three side by side: the ink look, the Cycles reference and the packed
// files in the bare viewer, from the cameras named in settings.json.
//
//   node tools/real/proof.mjs                      (npm run real:proof)
//   node tools/real/proof.mjs --views trailhead-spawn --skip ink
//
// The Cycles pictures come from tools/real/render.py and are only read here.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXPORT_DIR, GL, HERE, PYTHON, ROOT, args, devServer, ensureDir, loadPlaywright, settings } from './lib.mjs';

const opt = args(process.argv.slice(2));
const cfg = settings();
const port = Number(opt.port ?? process.env.REAL_PORT ?? cfg.port);
const dir = ensureDir(path.resolve(ROOT, String(opt.dir ?? '.shots/real')));
const names = opt.views && opt.views !== 'all' ? String(opt.views).split(',') : Object.keys(cfg.views);
const skip = new Set(String(opt.skip ?? '').split(','));
const [width, height] = String(opt.size ?? '1280x720').split('x').map(Number);
const exp = JSON.parse(readFileSync(path.join(EXPORT_DIR, 'export.json'), 'utf8'));

const server = await devServer(port);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: GL });
try {
  for (const name of names) {
    const v = cfg.views[name];
    if (!skip.has('ink')) {
      const q = new URLSearchParams({ still: '1', q: 'high', ui: '0' });
      if (v.view) q.set('d', v.view);
      else q.set('cam', v.cam.join(','));
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`http://localhost:${port}/?${q}`);
      await page.waitForFunction(() => window.__world && window.__world.ready && window.__world.built().length >= 11, null, { timeout: 240000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(dir, `ink-${name}.png`), timeout: 180000 });
      await page.close();
    }
    if (!skip.has('real')) {
      const q = new URLSearchParams();
      if (v.view) q.set('view', v.view);
      else {
        q.set('cam', v.cam.join(','));
        q.set('fov', String(v.fov ?? 46));
      }
      if (opt.half) q.set('half', '1');
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => console.error('[viewer]', e.message));
      await page.goto(`http://localhost:${port}/tools/real/viewer.html?${q}`);
      await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 240000 });
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => window.__viewer);
      await page.screenshot({ path: path.join(dir, `real-${name}.png`), timeout: 180000 });
      console.log(`${name}: viewer draws ${info.calls} calls, ${info.triangles} triangles`);
      await page.close();
    }
    const parts = [
      ['The drawing', path.join(dir, `ink-${name}.png`)],
      ['Cycles, the reference', path.join(dir, `cycles-${name}.png`)],
      ['The browser, packed files', path.join(dir, `real-${name}.png`)],
    ].filter(([, f]) => existsSync(f));
    const a = [path.join(HERE, 'images.py'), 'sheet', '-', path.join(dir, `sheet-${name}.png`)];
    for (const [label, f] of parts) a.push('--panel', `${label}=${f}`);
    execFileSync(PYTHON, a, { stdio: 'inherit' });
  }
} finally {
  await browser.close();
  await server.stop();
}
