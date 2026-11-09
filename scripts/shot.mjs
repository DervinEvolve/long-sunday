#!/usr/bin/env node
// Screenshots of the running world. The dev server has to be up already.
//
//   node scripts/shot.mjs --port 5185 --d studio --out .shots/studio.png
//   node scripts/shot.mjs --port 5185 --d studio --solo --stats
//   node scripts/shot.mjs --port 5185 --cam 400,95,470,0,-45,-10 --out .shots/over.png
//   node scripts/shot.mjs --port 5185 --tour --dir .shots/tour
//
// Flags:
//   --port n          dev server port (5173)
//   --d id            district to stand in (its arrival point)
//   --solo            build only that district
//   --cam x,y,z,tx,ty,tz   fixed camera: from the first point, looking at the second
//   --yaw deg         which way he faces (0 north, 90 west)
//   --size WxH        viewport (1280x720)
//   --q tier          low, medium or high (high: software GL would guess low)
//   --wait ms         extra settle time before the shot (400)
//   --stats           print stats() and the per-district costs as JSON
//   --debug           stats readout and colliders in red
//   --ui              keep the interface (it is skipped by default so the world is bare)
//   --tour            every district from its arrival point plus one high overview, with a table
//   --dir path        where the tour goes (.shots/tour)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BUDGET = { calls: 150, triangles: 400000 };
const OVERVIEW = [400, 95, 470, 0, -45, -10];
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    // Not in this project: use the global install.
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(root, 'x.js'))('playwright');
  }
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith('--') && !/^--?\d/.test(next))) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const opt = args(process.argv.slice(2));
const port = Number(opt.port ?? 5173);
const [width, height] = String(opt.size ?? '1280x720').split('x').map(Number);
const wait = Number(opt.wait ?? 400);
const quality = String(opt.q ?? 'high');

function url(extra) {
  const q = new URLSearchParams({ still: '1', q: quality, ...extra });
  if (!opt.ui) q.set('ui', '0');
  if (opt.debug) q.set('debug', '1');
  return `http://localhost:${port}/?${q}`;
}

async function settle(page) {
  // Two frames so the stats belong to the picture, then whatever was asked for.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  await page.waitForTimeout(wait);
}

async function open(page, extra, need) {
  await page.goto(url(extra));
  await page.waitForFunction(
    (id) => {
      const w = window.__world;
      return !!w && w.ready && (!id || w.built().includes(id));
    },
    need ?? null,
    { timeout: 180000 },
  );
  await settle(page);
}

const read = (page) =>
  page.evaluate(() => {
    const w = window.__world;
    const p = w.player();
    const hit = w.poi();
    return { stats: w.stats(), player: p, poi: hit ? { prompt: hit.prompt, entry: hit.entry ? hit.entry.id : null } : null, costs: w.costs() };
  });

async function single(page) {
  const extra = {};
  const d = typeof opt.d === 'string' ? opt.d : null;
  if (d) extra.d = d;
  if (d && opt.solo) extra.solo = d;
  if (typeof opt.cam === 'string') extra.cam = opt.cam;
  if (opt.yaw !== undefined) extra.yaw = String(opt.yaw);
  await open(page, extra, d);
  const out = typeof opt.out === 'string' ? opt.out : `.shots/${d ?? 'world'}.png`;
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out });
  const info = await read(page);
  if (opt.stats) console.log(JSON.stringify(info, null, 2));
  else console.log(`${out}  calls ${info.stats.calls}  triangles ${info.stats.triangles}`);
}

async function tour(page) {
  const dir = typeof opt.dir === 'string' ? opt.dir : '.shots/tour';
  mkdirSync(path.resolve(dir), { recursive: true });
  await open(page, {}, null);
  const ids = await page.evaluate(() => window.__world.built());
  const rows = [];
  const ready = () => page.waitForFunction(() => !!window.__world && window.__world.ready, null, { timeout: 180000 });
  // The dev server reloads the page when a source file is saved, which can land in the middle of a
  // tour. So each shot sets itself up from scratch and is tried again if the page went away.
  const shoot = async (name, place) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await ready();
        await page.evaluate(place.fn, place.arg);
        await settle(page);
        const file = path.join(dir, `${name}.png`);
        await page.screenshot({ path: file });
        const info = await read(page);
        const cost = info.costs[name];
        rows.push({
          shot: name,
          calls: info.stats.calls,
          triangles: info.stats.triangles,
          own: cost ? `${cost.calls} / ${cost.triangles}${cost.placeholder ? ' (placeholder)' : ''}` : '',
          over: info.stats.calls > BUDGET.calls || info.stats.triangles > BUDGET.triangles ? 'OVER' : '',
        });
        return;
      } catch (err) {
        if (attempt >= 3) throw err;
        await page.waitForTimeout(1500);
      }
    }
  };
  const stand = (d) => {
    window.__world.setFreeCamera(null);
    window.__world.teleport(d);
  };
  const hover = (c) => window.__world.setFreeCamera(c.slice(0, 3), c.slice(3));
  for (const id of ids.slice().sort()) await shoot(id, { fn: stand, arg: id });
  await shoot('overview', { fn: hover, arg: OVERVIEW });

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('shot', 14)}${pad('calls', 8)}${pad('triangles', 12)}${pad('district alone (calls / triangles)', 38)}`);
  for (const r of rows) console.log(`${pad(r.shot, 14)}${pad(r.calls, 8)}${pad(r.triangles, 12)}${pad(r.own, 38)}${r.over}`);
  console.log(`budget        ${pad(BUDGET.calls, 8)}${pad(BUDGET.triangles, 12)}`);
  console.log(`written to ${dir}`);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: GL });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => console.error('[page error]', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[page ${m.type()}]`, m.text());
  });
  if (opt.tour) await tour(page);
  else await single(page);
} finally {
  await browser.close();
}
