#!/usr/bin/env node
// Step 1 of the real look: take the built world out of the browser.
//
//   node tools/real/export.mjs            (npm run real:export)
//   node tools/real/export.mjs --dir /some/where     write there instead, to compare two exports
//
// Opens the dev page twice in headless Chromium.
//   1. With the clock running, stands in every district for a moment and notes which meshes move.
//      Those stay live in the browser and are left out of the baked chunks.
//   2. With ?still=1, asks the export hook (src/real/exportScene.ts) for one binary glTF per chunk
//      and for the lettering atlas, and reads the follow camera at every arrival point.
// Writes tools/real/cache/export/<chunk>.glb, lettering.png and export.json.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXPORT_DIR as CACHE_EXPORT, GL, args, devServer, ensureDir, fmtBytes, loadPlaywright, matches, settings, sha } from './lib.mjs';

const opt = args(process.argv.slice(2));
const cfg = settings();
const port = Number(opt.port ?? process.env.REAL_PORT ?? cfg.port);
const EXPORT_DIR = opt.dir ? path.resolve(String(opt.dir)) : CACHE_EXPORT;
const t0 = Date.now();
const server = await devServer(port);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: GL });
ensureDir(EXPORT_DIR);

const ready = (page) =>
  page.waitForFunction(() => window.__world && window.__world.ready && window.__world.built().length >= 11 && window.__realExport, null, {
    timeout: 240000,
  });

/** Run `fn` on a fresh page. Somebody saving a source file makes the dev server reload the page
 *  under me; when that happens, start that pass again. */
async function onPage(query, viewport, fn) {
  for (let attempt = 1; ; attempt++) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (e) => console.error('[page]', e.message));
    try {
      await page.goto(`http://localhost:${port}/?${query}`);
      await ready(page);
      const nonce = String(Math.random());
      await page.evaluate((n) => (window.__exportNonce = n), nonce);
      const result = await fn(page);
      if ((await page.evaluate(() => window.__exportNonce)) !== nonce) throw new Error('the page reloaded');
      return result;
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`[export] pass interrupted (${String(err.message).split('\n')[0]}), again`);
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      await page.close().catch(() => {});
    }
  }
}

try {
  // ---- 1. what moves -------------------------------------------------------------------------
  const moving = await onPage('export=1&q=high&ui=0', { width: 480, height: 270 }, async (page) => {
    const found = new Set();
    const ids = await page.evaluate(() => window.__world.built());
    for (const id of ids) {
      await page.evaluate((d) => window.__world.teleport(d), id);
      await page.waitForTimeout(700);
      const a = await page.evaluate(() => window.__realExport.signatures());
      await page.waitForTimeout(1600);
      const b = await page.evaluate(() => window.__realExport.signatures());
      for (const k of Object.keys(a)) if (a[k] !== b[k]) found.add(k);
    }
    return found;
  });

  // ---- 2. the chunks -------------------------------------------------------------------------
  const out = await onPage('export=1&q=high&still=1&ui=0', { width: 1280, height: 720 }, async (page) => {
  await page.waitForTimeout(500);
  const meshes = await page.evaluate(() => window.__realExport.meshes());
  const meta = await page.evaluate(() => window.__realExport.meta());
  const fate = (m) => {
    if (matches(cfg.drop, m.path)) return 'drop';
    if (matches(cfg.bake, m.path)) return 'bake';
    if (m.chunk === 'world' || matches(cfg.live, m.path) || moving.has(m.path)) return 'live';
    return 'bake';
  };
  const chunkIds = [...new Set(meshes.map((m) => m.chunk))].filter((c) => c !== 'world');
  const chunks = {};
  for (const id of chunkIds) {
    const mine = meshes.filter((m) => m.chunk === id);
    const skip = mine.filter((m) => fate(m) !== 'bake').map((m) => m.path);
    const b64 = await page.evaluate(([c, s]) => window.__realExport.chunk(c, s), [id, skip]);
    const bytes = Buffer.from(b64, 'base64');
    writeFileSync(path.join(EXPORT_DIR, `${id}.glb`), bytes);
    const baked = mine.filter((m) => fate(m) === 'bake');
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const m of baked)
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], m.box[k]);
        box[k + 3] = Math.max(box[k + 3], m.box[k + 3]);
      }
    chunks[id] = {
      file: `${id}.glb`,
      hash: sha(bytes),
      bytes: bytes.length,
      triangles: baked.reduce((n, m) => n + m.triangles, 0),
      box,
      replaces: baked.map((m) => m.path),
      live: mine.filter((m) => fate(m) === 'live').map((m) => m.path),
      drop: mine.filter((m) => fate(m) === 'drop').map((m) => m.path),
    };
    console.log(
      `${id.padEnd(12)} ${String(chunks[id].triangles).padStart(7)} tris  ${fmtBytes(bytes.length).padStart(9)}  baked ${baked.length}  live ${chunks[id].live.length}`,
    );
  }
  const world = meshes.filter((m) => m.chunk === 'world');

  // The lettering atlas, exactly as the ink look has it after the whole world is built.
  const atlas = await page.evaluate(() => window.__realExport.atlas());
  if (!atlas.startsWith('data:image/png;base64,')) throw new Error('the lettering atlas did not come back');
  const atlasBytes = Buffer.from(atlas.slice(atlas.indexOf(',') + 1), 'base64');
  writeFileSync(path.join(EXPORT_DIR, 'lettering.png'), atlasBytes);

  // The follow camera at every arrival point, for pictures that have to match the ink look.
  const cameras = {};
  for (const s of meta.sites) {
    await page.evaluate((d) => window.__world.teleport(d), s.id);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))));
    await page.waitForTimeout(250);
    cameras[s.id] = await page.evaluate(() => window.__realExport.cameraPose());
  }

  return {
    exportedAt: new Date().toISOString(),
    meta,
    chunks,
    worldLive: world.filter((m) => fate(m) === 'live').map((m) => m.path),
    worldDrop: world.filter((m) => fate(m) === 'drop').map((m) => m.path),
    moving: [...moving].sort(),
    atlas: { file: 'lettering.png', hash: sha(atlasBytes), bytes: atlasBytes.length },
    cameras,
  };
  });
  writeFileSync(path.join(EXPORT_DIR, 'export.json'), JSON.stringify(out, null, 1));
  console.log(`moving: ${out.moving.join(', ')}`);
  console.log(`export done in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${Object.keys(out.chunks).length} chunks`);
} finally {
  await browser.close();
  await server.stop();
}
