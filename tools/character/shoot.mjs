#!/usr/bin/env node
// Pictures of the figure from the stage page. The dev server has to be up.
//   node tools/character/shoot.mjs <name> <WxH> "<query>" "<label or ->"   (repeat the four for more pictures)
// Writes .shots/figure/<name>.png and prints his cost and the time one update takes.
// PORT=5173 by default. Needs Playwright installed globally, like scripts/shot.mjs.
import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
const { chromium } = createRequire(path.join(root, 'x.js'))('playwright');
const jobs = [];
const a = process.argv.slice(2);
for (let i = 0; i + 2 < a.length + 1; i += 4) if (a[i]) jobs.push({ name: a[i], size: a[i + 1], query: a[i + 2], label: a[i + 3] });
const browser = await chromium.launch({ args: GL });
for (const j of jobs) {
  const [w, h] = j.size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto(`http://localhost:${process.env.PORT ?? 5173}/tools/character/stage.html?${j.query}`);
  await page.waitForFunction(() => window.__stage && window.__stage.ready, null, { timeout: 180000 });
  mkdirSync('.shots/figure', { recursive: true });
  const out = `.shots/figure/${j.name}.png`;
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => ({ cost: window.__stage.cost, updateMs: +window.__stage.updateMs.toFixed(4), stats: window.__stage.stats() }));
  if (j.label && j.label !== '-') execFileSync('convert', [out, '-gravity', 'NorthWest', '-pointsize', '18', '-fill', '#1c1a33', '-annotate', '+8+6', j.label, out]);
  console.log(out, JSON.stringify(info));
  await ctx.close();
}
await browser.close();
